import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import type { BillingKind } from '../domain/billing';

/** Who pays for a ticket, and its interventions — each with its row-level security. */
export function billingMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.ticket_billing (
  ticket_id text primary key references ${s}.tickets (ticket_id),
  organization_id text not null,
  kind text not null check (kind in ('warranty', 'contract', 'billable')),
  party_id text,
  party_name text,
  project_id text,
  project_name text,
  contract_reference text,
  set_by text not null,
  set_at timestamptz not null default now()
);
${policy('ticket_billing')}
grant select, insert, update on ${s}.ticket_billing to ${options.appRole};

create table ${s}.interventions (
  intervention_id text primary key,
  organization_id text not null,
  ticket_id text not null references ${s}.tickets (ticket_id),
  done_on date not null,
  label text not null check (length(label) between 1 and 300),
  minutes integer not null check (minutes >= 0),
  hourly_rate bigint not null check (hourly_rate >= 0),
  parts bigint not null default 0 check (parts >= 0),
  amount bigint not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- The draft invoice Kete Finance prepared for it: never prepared twice.
  invoice_draft_id text,
  invoiced_at timestamptz,
  recorded_by text not null,
  created_at timestamptz not null default now()
);
create index interventions_by_ticket on ${s}.interventions (organization_id, ticket_id);
${policy('interventions')}
grant select, insert, update on ${s}.interventions to ${options.appRole};
`;
}

export interface Billing {
  kind: BillingKind;
  partyId: string | null;
  partyName: string | null;
  projectId: string | null;
  projectName: string | null;
  contractReference: string | null;
}

export interface Intervention {
  interventionId: string;
  doneOn: string;
  label: string;
  minutes: number;
  hourlyRate: number;
  parts: number;
  amount: number;
  currency: string;
  invoiceDraftId: string | null;
}

export async function setBilling(
  db: SqlExecutor,
  organizationId: string,
  ticketId: string,
  billing: Billing & { setBy: string },
): Promise<void> {
  await db.query(
    `insert into ticket_billing
       (ticket_id, organization_id, kind, party_id, party_name, project_id, project_name,
        contract_reference, set_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (ticket_id) do update set
       kind = excluded.kind, party_id = excluded.party_id, party_name = excluded.party_name,
       project_id = excluded.project_id, project_name = excluded.project_name,
       contract_reference = excluded.contract_reference, set_by = excluded.set_by, set_at = now()`,
    [
      ticketId,
      organizationId,
      billing.kind,
      billing.partyId,
      billing.partyName,
      billing.projectId,
      billing.projectName,
      billing.contractReference,
      billing.setBy,
    ],
  );
}

export async function billingOf(db: SqlExecutor, ticketId: string): Promise<Billing | null> {
  const { rows } = await db.query<{
    kind: BillingKind;
    party_id: string | null;
    party_name: string | null;
    project_id: string | null;
    project_name: string | null;
    contract_reference: string | null;
  }>(
    `select kind, party_id, party_name, project_id, project_name, contract_reference
       from ticket_billing where ticket_id = $1`,
    [ticketId],
  );
  const row = rows[0];
  return row
    ? {
        kind: row.kind,
        partyId: row.party_id,
        partyName: row.party_name,
        projectId: row.project_id,
        projectName: row.project_name,
        contractReference: row.contract_reference,
      }
    : null;
}

export async function insertIntervention(
  db: SqlExecutor,
  intervention: Omit<Intervention, 'interventionId' | 'invoiceDraftId'> & {
    organizationId: string;
    ticketId: string;
    recordedBy: string;
  },
): Promise<string> {
  const interventionId = newId('itv');
  await db.query(
    `insert into interventions
       (intervention_id, organization_id, ticket_id, done_on, label, minutes, hourly_rate, parts,
        amount, currency, recorded_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      interventionId,
      intervention.organizationId,
      intervention.ticketId,
      intervention.doneOn,
      intervention.label,
      intervention.minutes,
      intervention.hourlyRate,
      intervention.parts,
      intervention.amount,
      intervention.currency,
      intervention.recordedBy,
    ],
  );
  return interventionId;
}

export async function interventionsOf(db: SqlExecutor, ticketId: string): Promise<Intervention[]> {
  const { rows } = await db.query<{
    intervention_id: string;
    done_on: string;
    label: string;
    minutes: number;
    hourly_rate: string;
    parts: string;
    amount: string;
    currency: string;
    invoice_draft_id: string | null;
  }>(
    `select intervention_id, to_char(done_on, 'YYYY-MM-DD') as done_on, label, minutes, hourly_rate,
            parts, amount, currency, invoice_draft_id
       from interventions where ticket_id = $1 order by done_on, created_at`,
    [ticketId],
  );
  return rows.map((row) => ({
    interventionId: row.intervention_id,
    doneOn: row.done_on,
    label: row.label,
    minutes: row.minutes,
    hourlyRate: Number(row.hourly_rate),
    parts: Number(row.parts),
    amount: Number(row.amount),
    currency: row.currency,
    invoiceDraftId: row.invoice_draft_id,
  }));
}

export async function markInvoiced(
  db: SqlExecutor,
  interventionIds: readonly string[],
  draftId: string,
): Promise<void> {
  await db.query(
    `update interventions set invoice_draft_id = $2, invoiced_at = now()
      where intervention_id = any($1::text[]) and invoice_draft_id is null`,
    [interventionIds, draftId],
  );
}
