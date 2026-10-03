import type { DraftReview } from '@kete/capabilities';
import { executeCommand, type CommandDefinition } from '@kete/commands';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { transaction } from '@/platform/db';
import { closeTask, enterpriseUrl, sendReading, sendTask } from '@/platform/enterprise';
import { env } from '@/platform/env';
import * as m from '@/paraglide/messages.js';
import { registry } from '@/platform/registry';
import { asPerson, holds } from '@/platform/rights';
import { personOf, screenActor, tokenOf } from '@/platform/session';
import {
  acknowledgeTicket,
  closeTicket,
  createQueue,
  reopenTicket,
  restoreTicket,
  resumeTicket,
  suspendTicket,
  withdrawTicket,
} from './commands';
import { elapsedMinutes, indicatorsOf, TicketRuleError, withinTarget } from './domain/clock';
import {
  findTicket,
  listQueues,
  listTickets,
  restoredBetween,
} from './infrastructure/ticket.table';
import { queueInput, targetHours, ticketInput, type Ticket } from './ticket.record';

/** A draft as the verification screen shows it: plain, serializable values. */
export interface ReviewScreen {
  draftId: string;
  description: string;
  autonomy: 3 | 4;
  status: 'prepared' | 'validated' | 'refused';
  fields: { key: string; title: string; value: string; source: string | null; uncertain: boolean }[];
}

function toScreen(review: DraftReview): ReviewScreen {
  const properties = (review.schema['properties'] ?? {}) as Record<string, { title?: string }>;
  return {
    draftId: review.draftId,
    description: review.description,
    autonomy: review.autonomy,
    status: review.status,
    fields: Object.entries(review.values).map(([key, value]) => {
      const provenance = review.provenance[key];
      return {
        key,
        title: properties[key]?.title ?? key,
        value: value === null || value === undefined ? '' : String(value),
        source: provenance?.source ?? null,
        uncertain: provenance?.certainty === 'low',
      };
    }),
  };
}

export class ScreenError extends Error {
  constructor(readonly code: 'signed_out' | 'no_organization' | 'forbidden' | 'not_found') {
    super(code);
    this.name = 'ScreenError';
  }
}

/** The person on this screen, in her organization, with her rights for what follows. */
async function signedIn() {
  const request = getRequest();
  const identity = await personOf(request);
  if (!identity) throw new ScreenError('signed_out');
  if (!identity.organizationId) throw new ScreenError('no_organization');
  const token = await tokenOf(request);
  return {
    identity,
    caller: { actor: screenActor(identity), organizationId: identity.organizationId },
    /** Runs `work` with her rights: her grants at Kete Enterprise, or her role's defaults. */
    as: <T,>(work: () => T | Promise<T>) => asPerson(identity, work, token),
  };
}

/** A ticket as the screens show it: dates as text, and its clock. */
export interface TicketScreen extends Omit<
  Ticket,
  'receivedAt' | 'acknowledgedAt' | 'suspendedSince' | 'restoredAt' | 'closedAt'
> {
  receivedAt: string;
  acknowledgedAt: string | null;
  restoredAt: string | null;
  targetHours: number;
  elapsedMinutes: number | null;
  withinTarget: boolean | null;
}

const toScreenTicket = (t: Ticket): TicketScreen => ({
  ticketId: t.ticketId,
  queueId: t.queueId,
  queueName: t.queueName,
  title: t.title,
  description: t.description,
  criticality: t.criticality,
  status: t.status,
  requesterName: t.requesterName,
  assigneeName: t.assigneeName,
  suspendedMinutes: t.suspendedMinutes,
  suspendReason: t.suspendReason,
  reopenCount: t.reopenCount,
  receivedAt: t.receivedAt.toISOString(),
  acknowledgedAt: t.acknowledgedAt?.toISOString() ?? null,
  restoredAt: t.restoredAt?.toISOString() ?? null,
  targetHours: targetHours[t.criticality],
  elapsedMinutes: elapsedMinutes(t),
  withinTarget: withinTarget(t),
});

export const fetchPerson = createServerFn({ method: 'GET' }).handler(async () => {
  const identity = await personOf(getRequest());
  return identity ? { name: identity.name, organizationId: identity.organizationId } : null;
});

export const fetchBoard = createServerFn({ method: 'GET' })
  .validator((input: unknown) =>
    z.object({ open: z.boolean().default(true) }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const { identity, caller, as } = await signedIn();
    return as(async () => {
      if (!holds('tickets:read')) throw new ScreenError('forbidden');
      return transaction(caller.organizationId, async (db) => ({
        queues: await listQueues(db),
        tickets: (await listTickets(db, { open: data.open })).map(toScreenTicket),
        manages: holds('tickets:manage'),
      }));
    });
  });

export const fetchTicket = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({ ticketId: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data }) => {
    const { identity, caller, as } = await signedIn();
    return as(async () => {
      if (!holds('tickets:read')) throw new ScreenError('forbidden');
      const ticket = await transaction(caller.organizationId, (db) => findTicket(db, data.ticketId));
      return ticket ? toScreenTicket(ticket) : null;
    });
  });

/** A person opens a ticket: the same capability an agent acting for her would use. */
export const addTicket = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ticketInput.parse(input))
  .handler(async ({ data }) => {
    const { identity, caller, as } = await signedIn();
    const result = await as(() =>
      registry.invoke({ ...caller, name: 'tickets_open', input: data }),
    );
    return { status: result.status };
  });

const steps: Record<string, CommandDefinition<z.ZodType, unknown>> = {
  acknowledge: acknowledgeTicket as unknown as CommandDefinition<z.ZodType, unknown>,
  suspend: suspendTicket as unknown as CommandDefinition<z.ZodType, unknown>,
  resume: resumeTicket as unknown as CommandDefinition<z.ZodType, unknown>,
  restore: restoreTicket as unknown as CommandDefinition<z.ZodType, unknown>,
  close: closeTicket as unknown as CommandDefinition<z.ZodType, unknown>,
  withdraw: withdrawTicket as unknown as CommandDefinition<z.ZodType, unknown>,
  reopen: reopenTicket as unknown as CommandDefinition<z.ZodType, unknown>,
};

/** A step of a ticket's life, from its screen: refused steps come back as their code. */
export const moveTicket = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z
      .object({
        ticketId: z.string().min(1).max(80),
        step: z.enum(['acknowledge', 'suspend', 'resume', 'restore', 'close', 'reopen', 'withdraw']),
        reason: z.string().trim().max(600).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { identity, caller, as } = await signedIn();
    return as(async () => {
      if (!holds('tickets:write')) return { ok: false, error: 'forbidden' };
      try {
        await transaction(caller.organizationId, (db) =>
          executeCommand(db, steps[data.step] as CommandDefinition<z.ZodType, unknown>, {
            ...caller,
            idempotencyKey: `screen-${randomUUID()}`,
            input: {
              ticketId: data.ticketId,
              actorName: identity.name,
              ...(data.reason ? { reason: data.reason } : {}),
            },
          }),
        );
        await followInEnterprise(caller.organizationId, data.ticketId, data.step);
        return { ok: true, error: null };
      } catch (error) {
        if (error instanceof TicketRuleError) return { ok: false, error: error.code };
        throw error;
      }
    });
  });

export const addQueue = createServerFn({ method: 'POST' })
  .validator((input: unknown) => queueInput.parse(input))
  .handler(async ({ data }) => {
    const { identity, caller, as } = await signedIn();
    return as(async () => {
      if (!holds('tickets:manage')) throw new ScreenError('forbidden');
      await transaction(caller.organizationId, (db) =>
        executeCommand(db, createQueue, {
          ...caller,
          idempotencyKey: `screen-${randomUUID()}`,
          input: data,
        }),
      );
      return { ok: true };
    });
  });

const period = z.object({
  label: z.string().trim().min(1).max(40),
  from: z.iso.date(),
  to: z.iso.date(),
});

/** Each queue's indicators for a period, computed from its tickets restored in it. */
export const fetchIndicators = createServerFn({ method: 'GET' })
  .validator((input: unknown) => period.parse(input))
  .handler(async ({ data }) => {
    const { identity, caller, as } = await signedIn();
    return as(async () => {
      if (!holds('tickets:read')) throw new ScreenError('forbidden');
      const queues = await transaction(caller.organizationId, async (db) => {
        const all = await listQueues(db);
        return Promise.all(
          all.map(async (queue) => ({
            ...queue,
            ...indicatorsOf(await restoredBetween(db, queue.queueId, data.from, data.to)),
          })),
        );
      });
      return { queues, connected: enterpriseUrl() !== null, manages: holds('tickets:manage') };
    });
  });

/**
 * Sends a queue's indicator to Kete Enterprise as a reading, for the person: management control
 * there decides whether to take it into the reviews.
 */
export const publishIndicator = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    period.extend({ queueId: z.string().min(1).max(80) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { identity, caller, as } = await signedIn();
    const request = getRequest();
    return as(async () => {
      if (!holds('tickets:manage')) return { ok: false, error: 'forbidden', sent: 0 };
      const found = await transaction(caller.organizationId, async (db) => {
        const queue = (await listQueues(db)).find((q) => q.queueId === data.queueId);
        if (!queue) return null;
        return { queue, ...indicatorsOf(await restoredBetween(db, queue.queueId, data.from, data.to)) };
      });
      if (!found || found.rate === null) return { ok: false, error: 'nothing_to_send', sent: 0 };
      let sent = 0;
      for (const indicator of found.queue.indicators) {
        const answer = await sendReading(request, {
          quarter: data.label,
          indicator,
          value: found.rate,
          proof: `${found.queue.name} : ${found.restored} tickets rétablis du ${data.from} au ${data.to}, ${found.withinTarget} dans le délai de leur criticité ; ${found.reopened} rouverts sous 7 jours`,
        });
        if (!answer.ok) return { ok: false, error: answer.error, sent };
        sent += 1;
      }
      return { ok: true, error: null, sent };
    });
  });

/** A draft an agent prepared, as the person sees it before deciding. */
export const fetchReview = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({ draftId: z.string().min(1).max(128) }).parse(input))
  .handler(async ({ data }) => {
    const { identity, caller, as } = await signedIn();
    const review = await as(() => registry.review(caller, data.draftId));
    return review ? toScreen(review) : null;
  });

/** The person decides; level 4 arrives here already confirmed by the screen's dialog. */
export const decideReview = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z
      .discriminatedUnion('action', [
        z.object({
          action: z.literal('validate'),
          draftId: z.string().min(1).max(128),
          confirmed: z.boolean(),
        }),
        z.object({
          action: z.literal('refuse'),
          draftId: z.string().min(1).max(128),
          reason: z.string().trim().min(1).max(1000),
        }),
      ])
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { identity, caller, as } = await signedIn();
    const decided = await as(() =>
      data.action === 'validate'
        ? registry.decide({ ...caller, draftId: data.draftId, action: 'validate', confirmed: data.confirmed })
        : registry.decide({ ...caller, draftId: data.draftId, action: 'refuse', reason: data.reason }),
    );
    return { status: decided.status };
  });

/**
 * A ticket taken is a task in its holder's To do in Kete Enterprise, with its deadline; restored,
 * withdrawn or closed, the task leaves it (Enterprise spec 018).
 */
async function followInEnterprise(organizationId: string, ticketId: string, step: string) {
  const request = getRequest();
  if (step === 'acknowledge' || step === 'resume' || step === 'reopen') {
    const ticket = await transaction(organizationId, (db) => findTicket(db, ticketId));
    if (!ticket?.acknowledgedAt) return;
    const due = new Date(
      ticket.acknowledgedAt.getTime() +
        targetHours[ticket.criticality] * 3_600_000 +
        ticket.suspendedMinutes * 60_000,
    );
    await sendTask(request, {
      key: ticket.ticketId,
      title: m.task_restore({ title: ticket.title }),
      href: `${env.publicUrl}/tickets/${ticket.ticketId}`,
      dueAt: due.toISOString(),
    });
  } else if (step === 'restore' || step === 'withdraw' || step === 'close' || step === 'suspend') {
    await closeTask(request, ticketId);
  }
}
