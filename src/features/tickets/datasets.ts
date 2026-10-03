import { defineDataset } from '@kete/capabilities';
import { z } from 'zod';
import { elapsedMinutes, withinTarget } from './domain/clock';
import { ticketsReceivedBetween } from './infrastructure/ticket.table';

/**
 * What Support exposes to dashboards, the assistant and other apps (kete-core spec 045): one row
 * per ticket, read under « tickets:read », dated by its reception.
 */
export const ticketDatasets = [
  defineDataset({
    name: 'tickets',
    description:
      'One row per ticket: its queue, criticality, status, reception and restoration days, the hours to restore it, and 1 when restored within its target.',
    permission: 'tickets:read',
    // How far its rows may travel (kete-core spec 049): the organization's people, not beyond.
    classification: 'internal',
    row: z.object({
      queue: z.string(),
      criticality: z.string(),
      status: z.string(),
      receivedOn: z.string(),
      restoredOn: z.string().nullable(),
      hoursToRestore: z.number().nullable(),
      withinTarget: z.number(),
      open: z.number(),
    }),
    time: 'receivedOn',
    measures: ['hoursToRestore', 'withinTarget', 'open'],
    dimensions: ['queue', 'criticality', 'status'],
    async rows(query, { db }) {
      const tickets = await ticketsReceivedBetween(db, query);
      return tickets.map((t) => {
        const minutes = elapsedMinutes(t);
        return {
          queue: t.queueName,
          criticality: t.criticality,
          status: t.status,
          receivedOn: t.receivedAt.toISOString().slice(0, 10),
          restoredOn: t.restoredAt ? t.restoredAt.toISOString().slice(0, 10) : null,
          hoursToRestore: minutes === null ? null : Math.round(minutes / 6) / 10,
          withinTarget: withinTarget(t) ? 1 : 0,
          open: ['restored', 'closed', 'withdrawn'].includes(t.status) ? 0 : 1,
        };
      });
    },
  }),
];
