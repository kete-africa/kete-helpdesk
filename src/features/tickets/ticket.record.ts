import { defineRecord, field } from '@kete/records';
import { z } from 'zod';

import { criticalities, type Criticality } from './domain/criticality';

export { criticalities, targetHours, type Criticality } from './domain/criticality';

/** A ticket, described once: the form, the server's validation and the MCP tool's input. */
export const ticketInput = z.object({
  queueId: field(z.string().regex(/^que_[0-9a-f-]{8,64}$/), { label: 'ticket_queue_label' }),
  title: field(z.string().trim().min(1).max(200), { label: 'ticket_title_label' }),
  description: field(z.string().trim().max(4000).optional(), {
    label: 'ticket_description_label',
  }),
  criticality: field(z.enum(criticalities), { label: 'ticket_criticality_label' }),
});

export const ticketRecord = defineRecord({
  type: 'ticket',
  prefix: 'tkt',
  schema: ticketInput,
  summarize: (ticket) => `${ticket.title} (${ticket.criticality})`,
});

export type TicketStatus =
  | 'received'
  | 'acknowledged'
  | 'suspended'
  | 'restored'
  | 'closed'
  | 'withdrawn';

export interface Ticket {
  ticketId: string;
  queueId: string;
  queueName: string;
  title: string;
  description: string | null;
  criticality: Criticality;
  status: TicketStatus;
  requesterName: string;
  assigneeName: string | null;
  receivedAt: Date;
  acknowledgedAt: Date | null;
  suspendedSince: Date | null;
  suspendedMinutes: number;
  suspendReason: string | null;
  restoredAt: Date | null;
  closedAt: Date | null;
  reopenCount: number;
}

/** A queue: where tickets of one kind land, and the indicators they feed. */
export const queueInput = z.object({
  name: z.string().trim().min(1).max(120),
  /** The names of the organization's indicators this queue's tickets measure. */
  indicators: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
});

export interface Queue {
  queueId: string;
  name: string;
  indicators: string[];
}
