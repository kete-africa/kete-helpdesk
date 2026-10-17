import { performGesture } from '@kete/capabilities';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import { getCenter } from '@/platform/center';
import { transaction } from '@/platform/db';
import { registry } from '@/platform/registry';
import { asPerson, holds } from '@/platform/rights';
import { personOf, screenActor, tokenOf } from '@/platform/session';
import { billingInput, currencyIn, interventionInput, invoiceAsk } from './billing';
import { financeUrl } from './finance';
import { billingOf, interventionsOf } from './infrastructure/billing.table';

// The billing panel of a ticket: who pays, the interventions, the invoice prepared in Kete
// Finance. Each gesture is the capability an agent would only prepare a draft of.

async function signedIn() {
  const request = getRequest();
  const identity = await personOf(request);
  if (!identity?.organizationId) throw new Error('signed_out');
  const token = await tokenOf(request);
  const organizationId = identity.organizationId;
  return {
    caller: { actor: screenActor(identity), organizationId },
    as: <T,>(work: () => Promise<T>) => asPerson(identity, work, token),
    token,
  };
}

async function gesture<T>(name: string, input: unknown) {
  const { caller, as } = await signedIn();
  const outcome = await performGesture<T>(registry, { ...caller, name, input }, as);
  return outcome.ok
    ? { ok: true as const, output: outcome.output }
    : { ok: false as const, code: outcome.code, facts: outcome.facts };
}

export const fetchBilling = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({ ticketId: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data }) => {
    const { caller, as, token } = await signedIn();
    return as(async () => {
      if (!holds('tickets:read')) return null;
      const center = getCenter();
      return transaction(caller.organizationId, async (db) => ({
        currency: await currencyIn(db, caller.organizationId),
        bill: holds('tickets:bill'),
        finance: financeUrl() !== null,
        billing: await billingOf(db, data.ticketId),
        interventions: await interventionsOf(db, data.ticketId),
        parties: (await center.parties(token)).slice(0, 200).map((p) => ({ partyId: p.partyId, name: p.name })),
        projects: (await center.projects(token))
          .filter((p) => p.status === 'open')
          .map((p) => ({ projectId: p.projectId, name: p.name })),
        reviewBase: financeUrl() ? `${financeUrl()}/verification/` : null,
      }));
    });
  });

export const saveBilling = createServerFn({ method: 'POST' })
  .validator((input: unknown) => billingInput.parse(input))
  .handler(({ data }) => gesture<{ kind: string }>('tickets_set_billing', data));

export const addIntervention = createServerFn({ method: 'POST' })
  .validator((input: unknown) => interventionInput.parse(input))
  .handler(({ data }) => gesture<{ amount: number }>('interventions_record', data));

export const prepareInvoice = createServerFn({ method: 'POST' })
  .validator((input: unknown) => invoiceAsk.parse(input))
  .handler(({ data }) => gesture<{ draftId: string; reviewUrl: string }>('tickets_prepare_invoice', data));
