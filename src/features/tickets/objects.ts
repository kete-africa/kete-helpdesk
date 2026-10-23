import type { AppObject } from '@kete/center';
import type { SqlExecutor } from '@kete/tenancy';

// Support's tickets in the center's index (spec 009; kete-core spec 142, Kete Enterprise spec 100;
// doctrine D-062, R1, R15): each ticket said with its title, its step and the person who answers
// for it — its assignee, else its requester — so that « # », the search, Kete and the agents of the
// center find it with the person's own rights. Its data stays here. The kind « ticket » is declared
// in the manifest (`kete.json`, `objects`).

/** The open tickets, and those closed or withdrawn in the last week: what the index should know. */
export async function ticketObjects(db: SqlExecutor, publicUrl: string | null): Promise<AppObject[]> {
  const { rows } = await db.query<{
    ticket_id: string;
    title: string;
    status: string;
    requester_user_id: string;
    assignee_user_id: string | null;
    changed_at: Date;
  }>(
    `select ticket_id, title, status, requester_user_id, assignee_user_id,
            greatest(received_at, acknowledged_at, suspended_since, restored_at, closed_at) as changed_at
       from tickets
      where status not in ('closed', 'withdrawn')
         or greatest(received_at, closed_at) > now() - interval '7 days'
      order by changed_at desc
      limit 500`,
  );
  return rows.map((t) => ({
    kind: 'ticket',
    id: t.ticket_id,
    title: t.title,
    state: t.status,
    personId: t.assignee_user_id ?? t.requester_user_id,
    ...(publicUrl ? { href: `${publicUrl}/tickets/${encodeURIComponent(t.ticket_id)}` } : {}),
    updatedAt: t.changed_at.toISOString(),
  }));
}
