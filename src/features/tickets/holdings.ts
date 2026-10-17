import type { AppHolding } from '@kete/center';
import type { SqlExecutor } from '@kete/tenancy';
import * as m from '@/paraglide/messages.js';
import { targetHours, type Criticality } from './domain/criticality';

// What Support holds, as the center keeps it (kete-core spec 114; they replace the tasks once sent
// to the holder's To do): a ticket taken is its assignee's, due at its target — the time its
// criticality allows, plus what it waited suspended; suspended, it waits on its requester;
// restored, it waits on the requester's word before it is closed. A ticket nobody took has no
// holder yet: it stays in its queue.

/** The organizations with a ticket still open: the worker says their holdings (spec 006). */
export function ticketOrganizationsMigrationSql(options: { schema: string; appRole: string }) {
  const s = options.schema;
  return `
create function ${s}.ticket_organizations() returns table (organization_id text)
  language sql stable security definer set search_path = ${s}
  as $$ select distinct organization_id from tickets
        where status not in ('closed', 'withdrawn') $$;
revoke all on function ${s}.ticket_organizations() from public;
grant execute on function ${s}.ticket_organizations() to ${options.appRole};
`;
}

export async function ticketOrganizations(db: SqlExecutor): Promise<string[]> {
  const { rows } = await db.query<{ organization_id: string }>(
    `select organization_id from ticket_organizations() order by organization_id`,
  );
  return rows.map((r) => r.organization_id);
}

export async function ticketHoldings(
  db: SqlExecutor,
  publicUrl: string | null,
): Promise<AppHolding[]> {
  const { rows } = await db.query<{
    ticket_id: string;
    title: string;
    criticality: Criticality;
    status: 'acknowledged' | 'suspended' | 'restored';
    requester_user_id: string;
    assignee_user_id: string;
    acknowledged_at: Date;
    suspended_minutes: number;
  }>(
    `select ticket_id, title, criticality, status, requester_user_id, assignee_user_id,
            acknowledged_at, suspended_minutes
       from tickets
      where status in ('acknowledged', 'suspended', 'restored') and assignee_user_id is not null
      order by acknowledged_at limit 500`,
  );
  return rows.map((t): AppHolding => {
    const due = new Date(
      t.acknowledged_at.getTime() +
        targetHours[t.criticality] * 3_600_000 +
        t.suspended_minutes * 60_000,
    );
    const waits = t.status !== 'acknowledged' && t.requester_user_id !== t.assignee_user_id;
    return {
      kind: 'ticket',
      ref: t.ticket_id,
      object: { kind: 'ticket', id: t.ticket_id },
      what:
        t.status === 'restored'
          ? m.holding_ticket_restored({ title: t.title })
          : m.task_restore({ title: t.title }),
      holder: { kind: 'person', id: t.assignee_user_id },
      ...(waits
        ? { state: 'waiting' as const, waitingOn: { kind: 'person' as const, id: t.requester_user_id } }
        : { state: 'held' as const }),
      since: t.acknowledged_at.toISOString(),
      ...(t.status === 'restored' ? {} : { due: due.toISOString().slice(0, 10) }),
      ...(publicUrl?.startsWith('https://') ? { href: `${publicUrl}/tickets/${t.ticket_id}` } : {}),
    };
  });
}
