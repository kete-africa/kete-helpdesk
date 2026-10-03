import { defineCapability } from '@kete/capabilities';
import { exposeRecord } from '@kete/views';
import { z } from 'zod';
import * as m from '@/paraglide/messages.js';
import { openTicket } from './commands';
import { findTicket, searchTickets } from './infrastructure/ticket.table';
import { ticketInput, type Ticket } from './ticket.record';

/** What agents may do with tickets — through MCP, the chat or another app — and how far alone. */
export const ticketCapabilities = [
  // Level 1, by the integration contract (kete-core spec 045): `ticket_list` and `ticket_get`, a
  // table and a record a copilot shows, under the read permission — no integration code to write.
  ...exposeRecord<Ticket>({
    type: 'ticket',
    description: 'the open tickets of the queues, most critical first',
    permission: 'tickets:read',
    title: m.tickets_table_title,
    empty: m.tickets_table_empty,
    columns: [
      { key: 'queue', label: m.ticket_queue_label, value: (t) => t.queueName },
      { key: 'title', label: m.ticket_title_label, value: (t) => t.title },
      { key: 'criticality', label: m.ticket_criticality_label, value: (t) => t.criticality },
      { key: 'status', label: m.ticket_status_label, value: (t) => t.status },
    ],
    list: (db, query) => searchTickets(db, query),
    get: (db, id) => findTicket(db, id),
    label: (t) => t.title,
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
