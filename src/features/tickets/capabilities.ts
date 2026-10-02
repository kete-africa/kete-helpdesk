import { defineCapability } from '@kete/capabilities';
import { tableView, VIEWS } from '@kete/views';
import { z } from 'zod';
import * as m from '@/paraglide/messages.js';
import { openTicket } from './commands';
import { listTickets } from './infrastructure/ticket.table';
import { ticketInput } from './ticket.record';

/** What agents may do with tickets — through MCP, the chat or another app — and how far alone. */
export const ticketCapabilities = [
  // Level 1: reads, shown as a table in a copilot.
  defineCapability({
    name: 'tickets_list',
    description:
      'Lists the open tickets, most critical first: queue, title, criticality, status, assignee.',
    permission: 'tickets:read',
    autonomy: 1,
    input: z.object({}),
    view: VIEWS.table,
    async run(_input, { db }) {
      const tickets = await listTickets(db, { open: true });
      return tableView({
        title: m.tickets_table_title(),
        empty: m.tickets_table_empty(),
        columns: [
          { key: 'queue', label: m.ticket_queue_label() },
          { key: 'title', label: m.ticket_title_label() },
          { key: 'criticality', label: m.ticket_criticality_label() },
          { key: 'status', label: m.ticket_status_label() },
        ],
        rows: tickets.map((t) => ({
          queue: t.queueName,
          title: t.title,
          criticality: t.criticality,
          status: t.status,
        })),
      });
    },
  }),
  // Level 2: opening a ticket for the person commits nothing irreversible.
  defineCapability({
    name: 'tickets_open',
    description:
      'Opens a ticket in a queue for the person: a title, a description, and its criticality (critical, major, standard, minor).',
    permission: 'tickets:write',
    autonomy: 2,
    input: ticketInput,
    command: openTicket,
  }),
];
