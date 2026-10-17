import { defineCapability, definePermissions } from '@kete/capabilities';
import { defineCommand } from '@kete/commands';
import { formatMoney, money } from '@kete/money';
import { z } from 'zod';
import { findTicket } from '@/features/tickets';
import * as m from '@/paraglide/messages.js';
import { announce } from '@/platform/announce';
import { PRODUCT } from '@/platform/app';
import { getCenter } from '@/platform/center';
import { actingFor, currentToken } from '@/platform/person';
import { passGesture, sentencesOf } from '@/platform/policies';
import { words } from '@/platform/words';
import { billingKinds, BillingRuleError, costOf } from './domain/billing';
import { prepareInvoice } from './finance';
import {
  billingOf,
  insertIntervention,
  interventionsOf,
  markInvoiced,
  setBilling,
} from './infrastructure/billing.table';

/** The currency of interventions (ISO 4217); F CFA by default. */
export const CURRENCY = (process.env.SUPPORT_CURRENCY ?? 'XOF').toUpperCase();

const ticketId = z.string().regex(/^tkt_[0-9a-f-]{8,64}$/);
const amount = z.number().int().min(0).max(1_000_000_000_000);

export const billingInput = z.object({
  ticketId,
  kind: z.enum(billingKinds),
  partyId: z.string().max(64).optional(),
  partyName: z.string().trim().max(200).optional(),
  projectId: z.string().max(64).optional(),
  contractReference: z.string().trim().max(80).optional(),
});

export const interventionInput = z.object({
  ticketId,
  doneOn: z.iso.date(),
  label: z.string().trim().min(1).max(300),
  minutes: z.number().int().min(0).max(10_000),
  hourlyRate: amount,
  parts: amount.default(0),
});

export const invoiceAsk = z.object({ ticketId, taxRate: z.number().min(0).max(100).default(0) });

/** Who may say who pays, record interventions and prepare their invoice. */
export const billingPermissions = definePermissions([
  {
    name: 'tickets:bill',
    label: words(m.perm_tickets_bill),
    description: words(m.perm_tickets_bill_body),
    roles: ['owner', 'admin'],
  },
]);

/**
 * Says who pays for a ticket: the warranty, the client's contract, or the client. The client is
 * the center's third party; the project, the center's — which she must see.
 */
export const setTicketBilling = defineCommand({
  name: 'set-ticket-billing',
  input: billingInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    if (!(await findTicket(db, input.ticketId))) throw new BillingRuleError('ticket_not_found');
    if (input.kind === 'billable' && !input.partyName && !input.partyId) {
      throw new BillingRuleError('client_required');
    }
    let projectName: string | null = null;
    if (input.projectId) {
      const project = await getCenter().project(currentToken(), input.projectId);
      projectName = project?.name ?? null;
    }
    await setBilling(db, organizationId, input.ticketId, {
      kind: input.kind,
      partyId: input.partyId ?? null,
      partyName: input.partyName ?? null,
      projectId: input.projectId ?? null,
      projectName,
      contractReference: input.contractReference ?? null,
      setBy: actingFor(actor),
    });
    return { ticketId: input.ticketId, kind: input.kind };
  },
  summarize: (input) => `Ticket ${input.ticketId}: ${input.kind}`,
});

/** Records an intervention: its day, what was done, its time and its parts; its cost computed. */
export const recordIntervention = defineCommand({
  name: 'record-intervention',
  input: interventionInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    if (!(await findTicket(db, input.ticketId))) throw new BillingRuleError('ticket_not_found');
    const amountDue = costOf(input, CURRENCY);
    const interventionId = await insertIntervention(db, {
      organizationId,
      ticketId: input.ticketId,
      doneOn: input.doneOn,
      label: input.label,
      minutes: input.minutes,
      hourlyRate: input.hourlyRate,
      parts: input.parts,
      amount: amountDue,
      currency: CURRENCY,
      recordedBy: actingFor(actor),
    });
    return { interventionId, amount: amountDue };
  },
  summarize: (input) => `Intervention recorded on ${input.ticketId}`,
});

/**
 * A billable ticket's interventions not invoiced yet become a draft invoice in Kete Finance, for
 * the person: one line per intervention, its parts apart. The draft is verified and issued
 * there; here the interventions remember it, and are never prepared twice.
 */
export const prepareTicketInvoice = defineCommand({
  name: 'prepare-ticket-invoice',
  input: invoiceAsk,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    const ticket = await findTicket(db, input.ticketId);
    if (!ticket) throw new BillingRuleError('ticket_not_found');
    const billing = await billingOf(db, input.ticketId);
    if (billing?.kind !== 'billable') throw new BillingRuleError('not_billable');
    const open = (await interventionsOf(db, input.ticketId)).filter((one) => !one.invoiceDraftId);
    if (open.length === 0) throw new BillingRuleError('nothing_to_invoice');
    // Invoicing a client commits the organization: its policies decide, at the center (kete-core
    // spec 114) — the same for a person and her agent. Unruled, this app's rules are enough.
    const verdict = await passGesture(currentToken(), actor, {
      kind: 'invoice.issue',
      object: billing.partyId
        ? { kind: 'party', id: billing.partyId }
        : billing.projectId
          ? { kind: 'project', id: billing.projectId }
          : { kind: 'subject', id: `${PRODUCT}.invoice` },
      amount: { value: open.reduce((sum, one) => sum + one.amount, 0), currency: CURRENCY },
    });
    if (verdict.effect === 'refuse') {
      throw new BillingRuleError('refused_by_policy', { reason: sentencesOf(verdict) });
    }
    if (verdict.effect === 'approve') {
      throw new BillingRuleError('approval_required', {
        who: verdict.approvers.map((a) => a.approver).join(', '),
        reason: sentencesOf(verdict),
      });
    }
    const lines = open.flatMap((one) => {
      const time = one.amount - one.parts;
      const hours = Math.round((one.minutes / 60) * 100) / 100;
      return [
        ...(time > 0
          ? [{ label: m.invoice_line_time({ day: one.doneOn, label: one.label, hours: String(hours) }), quantity: 1, unitPrice: time }]
          : []),
        ...(one.parts > 0
          ? [{ label: m.invoice_line_parts({ day: one.doneOn, label: one.label }), quantity: 1, unitPrice: one.parts }]
          : []),
      ];
    });
    const prepared = await prepareInvoice({
      title: m.invoice_title({ title: ticket.title }),
      ...(billing.partyId ? { partyId: billing.partyId } : {}),
      partyName: billing.partyName ?? billing.partyId ?? '',
      ...(billing.projectId ? { projectId: billing.projectId } : {}),
      taxRate: input.taxRate,
      lines,
    });
    if (!prepared.ok) {
      throw new BillingRuleError(prepared.error, prepared.reason ? { reason: prepared.reason } : {});
    }
    await markInvoiced(db, open.map((one) => one.interventionId), prepared.draftId);
    const total = open.reduce((sum, one) => sum + one.amount, 0);
    await announce(db, {
      type: 'ticket.invoice_prepared',
      organization: organizationId,
      data: { ticketId: input.ticketId, draftId: prepared.draftId, amount: total, currency: CURRENCY },
    });
    return {
      draftId: prepared.draftId,
      reviewUrl: prepared.reviewUrl,
      amount: total,
      shown: formatMoney(money(total, CURRENCY)),
    };
  },
  summarize: ({ ticketId }) => `Invoice prepared in Kete Finance for ${ticketId}`,
});

export const billingEvents = [
  {
    type: 'ticket.invoice_prepared',
    description: 'A billable ticket’s interventions were prepared as a draft invoice in Kete Finance: the amount, before tax.',
    classification: 'internal',
    data: z.object({ ticketId: z.string(), draftId: z.string(), amount: z.number(), currency: z.string() }),
  },
] as const;

export const billingCapabilities = [
  defineCapability({
    name: 'ticket_billing',
    description: 'Who pays for a ticket — warranty, contract, the client — and its interventions with their cost.',
    permission: 'tickets:read',
    autonomy: 1,
    input: z.object({ ticketId }),
    run: async ({ ticketId: id }, { db }) => ({
      billing: await billingOf(db, id),
      interventions: await interventionsOf(db, id),
    }),
  }),
  defineCapability({
    name: 'tickets_set_billing',
    description: 'Says who pays for a ticket: warranty, contract, or the client (billable).',
    permission: 'tickets:bill',
    autonomy: 3,
    input: billingInput,
    command: setTicketBilling,
    draft: { recordType: 'ticket_billing' },
  }),
  defineCapability({
    name: 'interventions_record',
    description: 'Records an intervention on a ticket: its day, what was done, minutes, hourly rate, parts.',
    permission: 'tickets:bill',
    autonomy: 3,
    input: interventionInput,
    command: recordIntervention,
    draft: { recordType: 'intervention' },
  }),
  defineCapability({
    name: 'tickets_prepare_invoice',
    description:
      'Prepares, in Kete Finance, the draft invoice of a billable ticket’s interventions not invoiced yet. It is issued there, by who issues invoices.',
    permission: 'tickets:bill',
    autonomy: 3,
    input: invoiceAsk,
    command: prepareTicketInvoice,
    draft: { recordType: 'ticket_invoice' },
  }),
];
