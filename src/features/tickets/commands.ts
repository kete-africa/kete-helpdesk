import { defineCommand } from '@kete/commands';
import { z } from 'zod';
import { check, mayReopen, TicketRuleError, type Step } from './domain/clock';
import { findTicket, insertQueue, insertTicket, updateTicket } from './infrastructure/ticket.table';
import { queueInput, ticketInput } from './ticket.record';

const ticketRef = z.object({ ticketId: z.string().regex(/^tkt_[0-9a-f-]{8,64}$/) });

export const createQueue = defineCommand({
  name: 'create-queue',
  input: queueInput,
  reversibility: { reversible: false },
  handler: (input, { db, organizationId }) => insertQueue(db, organizationId, input),
  summarize: (input) => `Queue « ${input.name} » created`,
});

/** Opens a ticket: from a screen, or an agent acting for a person. */
export const openTicket = defineCommand({
  name: 'open-ticket',
  input: ticketInput.extend({ requesterName: z.string().trim().min(1).max(160).optional() }),
  // Opened by mistake, it is withdrawn until someone acknowledges it.
  reversibility: { reversible: true, inverse: 'withdraw-ticket' },
  async handler(input, { db, organizationId, actor }) {
    const requester = actor.onBehalfOf?.id ?? actor.id;
    return insertTicket(db, {
      organizationId,
      queueId: input.queueId,
      title: input.title,
      description: input.description,
      criticality: input.criticality,
      requesterUserId: requester,
      requesterName: input.requesterName ?? requester,
    }).catch((error: { code?: string }) => {
      if (error.code === '23503') throw new TicketRuleError('not_found');
      throw error;
    });
  },
  summarize: (input) => `Ticket « ${input.title} » opened (${input.criticality})`,
});

/** A step of a ticket's life: the clock's rules decide whether it may happen now. */
function step(
  name: Step,
  verb: string,
  apply: (ticket: NonNullable<Awaited<ReturnType<typeof findTicket>>>, input: {
    reason?: string | undefined;
    actorId: string;
    actorName?: string | undefined;
  }) => { sql: string; values: unknown[] },
) {
  return defineCommand({
    name: `${name}-ticket`,
    input: ticketRef.extend({
      reason: z.string().trim().min(1).max(600).optional(),
      actorName: z.string().trim().min(1).max(160).optional(),
    }),
    reversibility: { reversible: false },
    async handler(input, { db, actor }) {
      const ticket = await findTicket(db, input.ticketId, true);
      if (!ticket) throw new TicketRuleError('not_found');
      check(name, ticket.status);
      const change = apply(ticket, {
        reason: input.reason,
        actorId: actor.onBehalfOf?.id ?? actor.id,
        actorName: input.actorName,
      });
      await updateTicket(db, ticket.ticketId, change.sql, change.values);
      return { ticketId: ticket.ticketId };
    },
    summarize: (input) => `Ticket ${input.ticketId} ${verb}`,
  });
}

export const acknowledgeTicket = step('acknowledge', 'acknowledged', (_t, who) => ({
  // The clock starts here: at the acknowledgement, never at the request.
  sql: `status = 'acknowledged', acknowledged_at = now(), assignee_user_id = $2,
        assignee_name = $3`,
  values: [who.actorId, who.actorName ?? who.actorId],
}));

export const suspendTicket = step('suspend', 'suspended', (_t, who) => {
  // A suspension waits for a third party or the requester: dated and motivated, or none.
  if (!who.reason) throw new TicketRuleError('reason_required');
  return {
    sql: `status = 'suspended', suspended_since = now(), suspend_reason = $2`,
    values: [who.reason],
  };
});

export const resumeTicket = step('resume', 'resumed', () => ({
  sql: `status = 'acknowledged',
        suspended_minutes = suspended_minutes
          + greatest(0, round(extract(epoch from now() - suspended_since) / 60))::int,
        suspended_since = null`,
  values: [],
}));

export const restoreTicket = step('restore', 'restored', () => ({
  // The clock stops at restoration of the service, never at the closing.
  sql: `status = 'restored', restored_at = now()`,
  values: [],
}));

export const closeTicket = step('close', 'closed', () => ({
  sql: `status = 'closed', closed_at = now()`,
  values: [],
}));

export const withdrawTicket = step('withdraw', 'withdrawn', () => ({
  sql: `status = 'withdrawn', closed_at = now()`,
  values: [],
}));

export const reopenTicket = step('reopen', 'reopened', (ticket) => {
  if (!mayReopen(ticket.restoredAt, new Date())) throw new TicketRuleError('too_late');
  return {
    sql: `status = 'acknowledged', restored_at = null, closed_at = null,
          reopen_count = reopen_count + 1`,
    values: [],
  };
});
