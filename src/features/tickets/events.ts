import { z } from 'zod';

const facts = z.object({
  ticketId: z.string(),
  queueId: z.string(),
  criticality: z.enum(['critical', 'major', 'standard', 'minor']),
});

/**
 * The business events of tickets (kete-core spec 049): what Kete Enterprise may react to — the
 * morning briefing, an agent, a notification. Identifiers and facts only, never a title nor a
 * name; the manifest lists them (`emits`).
 */
export const ticketEvents = [
  {
    type: 'ticket.opened',
    description: 'A ticket was opened: its id, its queue, its criticality.',
    classification: 'internal',
    data: facts,
  },
  {
    type: 'ticket.restored',
    description: 'A ticket was restored: its id, its queue, its criticality.',
    classification: 'internal',
    data: facts,
  },
  {
    type: 'ticket.reopened',
    description: 'A restored ticket was reopened: its id, its queue, its criticality.',
    classification: 'internal',
    data: facts,
  },
] as const;
