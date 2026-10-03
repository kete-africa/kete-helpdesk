import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import type { Criticality, Queue, Ticket, TicketStatus } from '../ticket.record';

/** Queues and tickets, each with its row-level security in the same migration (constitution V). */
export function ticketsMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.queues (
  queue_id text primary key,
  organization_id text not null,
  name text not null check (length(name) between 1 and 120),
  indicators text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (organization_id, queue_id),
  unique (organization_id, name)
);
${policy('queues')}

create table ${s}.tickets (
  ticket_id text primary key,
  organization_id text not null,
  queue_id text not null,
  title text not null check (length(title) between 1 and 200),
  description text,
  criticality text not null check (criticality in ('critical', 'major', 'standard', 'minor')),
  status text not null default 'received'
    check (status in ('received', 'acknowledged', 'suspended', 'restored', 'closed', 'withdrawn')),
  requester_user_id text not null,
  requester_name text not null,
  assignee_user_id text,
  assignee_name text,
  received_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  suspended_since timestamptz,
  suspended_minutes integer not null default 0 check (suspended_minutes >= 0),
  suspend_reason text,
  restored_at timestamptz,
  closed_at timestamptz,
  reopen_count integer not null default 0,
  foreign key (organization_id, queue_id) references ${s}.queues (organization_id, queue_id)
);
create index tickets_queue on ${s}.tickets (organization_id, queue_id, status);
create index tickets_restored on ${s}.tickets (organization_id, restored_at);
${policy('tickets')}

grant select, insert, update on ${s}.queues, ${s}.tickets to ${options.appRole};
`;
}

type Row = {
  ticket_id: string;
  queue_id: string;
  queue_name: string;
  title: string;
  description: string | null;
  criticality: Criticality;
  status: TicketStatus;
  requester_name: string;
  assignee_name: string | null;
  received_at: Date;
  acknowledged_at: Date | null;
  suspended_since: Date | null;
  suspended_minutes: number;
  suspend_reason: string | null;
  restored_at: Date | null;
  closed_at: Date | null;
  reopen_count: number;
};

const toTicket = (r: Row): Ticket => ({
  ticketId: r.ticket_id,
  queueId: r.queue_id,
  queueName: r.queue_name,
  title: r.title,
  description: r.description,
  criticality: r.criticality,
  status: r.status,
  requesterName: r.requester_name,
  assigneeName: r.assignee_name,
  receivedAt: r.received_at,
  acknowledgedAt: r.acknowledged_at,
  suspendedSince: r.suspended_since,
  suspendedMinutes: r.suspended_minutes,
  suspendReason: r.suspend_reason,
  restoredAt: r.restored_at,
  closedAt: r.closed_at,
  reopenCount: r.reopen_count,
});

const columns = `t.ticket_id, t.queue_id, q.name as queue_name, t.title, t.description,
  t.criticality, t.status, t.requester_name, t.assignee_name, t.received_at, t.acknowledged_at,
  t.suspended_since, t.suspended_minutes, t.suspend_reason, t.restored_at, t.closed_at,
  t.reopen_count`;

export async function insertQueue(
  db: SqlExecutor,
  organizationId: string,
  input: { name: string; indicators: string[] },
): Promise<Queue> {
  const queueId = newId('que');
  await db.query(
    `insert into queues (queue_id, organization_id, name, indicators) values ($1, $2, $3, $4)`,
    [queueId, organizationId, input.name, input.indicators],
  );
  return { queueId, ...input };
}

export async function listQueues(db: SqlExecutor): Promise<Queue[]> {
  const { rows } = await db.query<{ queue_id: string; name: string; indicators: string[] }>(
    `select queue_id, name, indicators from queues order by name`,
  );
  return rows.map((r) => ({ queueId: r.queue_id, name: r.name, indicators: r.indicators }));
}

export async function insertTicket(
  db: SqlExecutor,
  input: {
    organizationId: string;
    queueId: string;
    title: string;
    description?: string | undefined;
    criticality: Criticality;
    requesterUserId: string;
    requesterName: string;
  },
): Promise<{ ticketId: string }> {
  const ticketId = newId('tkt');
  await db.query(
    `insert into tickets (ticket_id, organization_id, queue_id, title, description, criticality,
       requester_user_id, requester_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      ticketId,
      input.organizationId,
      input.queueId,
      input.title,
      input.description ?? null,
      input.criticality,
      input.requesterUserId,
      input.requesterName,
    ],
  );
  return { ticketId };
}

export async function findTicket(db: SqlExecutor, ticketId: string, lock = false) {
  const { rows } = await db.query<Row>(
    `select ${columns} from tickets t join queues q on q.queue_id = t.queue_id
      where t.ticket_id = $1 ${lock ? 'for update of t' : ''}`,
    [ticketId],
  );
  return rows[0] ? toTicket(rows[0]) : null;
}

export async function listTickets(
  db: SqlExecutor,
  filter: { open?: boolean; queueId?: string } = {},
): Promise<Ticket[]> {
  const { rows } = await db.query<Row>(
    `select ${columns} from tickets t join queues q on q.queue_id = t.queue_id
      where ($1::boolean is null or (t.status not in ('restored', 'closed', 'withdrawn')) = $1)
        and ($2::text is null or t.queue_id = $2)
      order by case t.criticality when 'critical' then 0 when 'major' then 1
                 when 'standard' then 2 else 3 end, t.received_at
      limit 500`,
    [filter.open ?? null, filter.queueId ?? null],
  );
  return rows.map(toTicket);
}

/** The tickets of a queue restored within a period: the indicators' population. */
export async function restoredBetween(
  db: SqlExecutor,
  queueId: string,
  from: string,
  to: string,
): Promise<Ticket[]> {
  const { rows } = await db.query<Row>(
    `select ${columns} from tickets t join queues q on q.queue_id = t.queue_id
      where t.queue_id = $1 and t.restored_at >= $2::date and t.restored_at < $3::date + 1`,
    [queueId, from, to],
  );
  return rows.map(toTicket);
}

export async function updateTicket(
  db: SqlExecutor,
  ticketId: string,
  sql: string,
  values: unknown[] = [],
): Promise<void> {
  await db.query(`update tickets set ${sql} where ticket_id = $1`, [ticketId, ...values]);
}

/** Open tickets matching a free text (or all), most critical first: what a copilot searches. */
export async function searchTickets(
  db: SqlExecutor,
  query: { text?: string | undefined; limit: number },
): Promise<Ticket[]> {
  const { rows } = await db.query<Row>(
    `select ${columns} from tickets t join queues q on q.queue_id = t.queue_id
      where t.status not in ('restored', 'closed', 'withdrawn')
        and ($1::text is null or t.title ilike '%' || $1 || '%' or t.description ilike '%' || $1 || '%'
             or q.name ilike '%' || $1 || '%')
      order by case t.criticality when 'critical' then 0 when 'major' then 1
                 when 'standard' then 2 else 3 end, t.received_at
      limit $2`,
    [query.text?.trim() || null, query.limit],
  );
  return rows.map(toTicket);
}

/** Tickets received within a period, for the data set: newest first, at most `limit`. */
export async function ticketsReceivedBetween(
  db: SqlExecutor,
  query: { from?: string | undefined; to?: string | undefined; limit: number },
): Promise<Ticket[]> {
  const { rows } = await db.query<Row>(
    `select ${columns} from tickets t join queues q on q.queue_id = t.queue_id
      where ($1::date is null or t.received_at >= $1::date)
        and ($2::date is null or t.received_at < $2::date + 1)
      order by t.received_at desc
      limit $3`,
    [query.from ?? null, query.to ?? null, query.limit],
  );
  return rows.map(toTicket);
}
