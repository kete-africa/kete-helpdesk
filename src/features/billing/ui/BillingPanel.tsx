import { Button, Panel, SelectField, Tag, TextField } from '@kete/design';
import { formatMoney, money } from '@kete/money';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { billingKinds, type BillingKind } from '../domain/kinds';
import { addIntervention, prepareInvoice, saveBilling, type fetchBilling } from '../functions';

type Loaded = NonNullable<Awaited<ReturnType<typeof fetchBilling>>>;

const kindLabel = (kind: BillingKind) =>
  ({ warranty: m.billing_warranty, contract: m.billing_contract, billable: m.billing_billable })[kind]();

function sayRefusal(code: string, facts: Record<string, string | number> = {}): string {
  const words: Record<string, () => string> = {
    not_billable: m.billing_error_not_billable,
    client_required: m.billing_error_client_required,
    nothing_to_invoice: m.billing_error_nothing,
    finance_not_connected: m.billing_error_not_connected,
    finance_refused: () => m.billing_error_refused({ reason: String(facts['reason'] ?? '') }),
    not_allowed: m.ticket_error_forbidden,
  };
  return (words[code] ?? m.error_generic)();
}

/** Who pays for a ticket, its interventions, and the invoice prepared in Kete Finance. */
export function BillingPanel({ ticketId, loaded }: { ticketId: string; loaded: Loaded }) {
  const router = useRouter();
  const shown = (amount: number) =>
    formatMoney(money(amount, loaded.currency), { locale: getLocale() });
  const [kind, setKind] = useState<BillingKind>(loaded.billing?.kind ?? 'warranty');
  const [partyId, setPartyId] = useState(loaded.billing?.partyId ?? '');
  const [partyName, setPartyName] = useState(loaded.billing?.partyName ?? '');
  const [projectId, setProjectId] = useState(loaded.billing?.projectId ?? '');
  const [contract, setContract] = useState(loaded.billing?.contractReference ?? '');
  const day = new Date().toISOString().slice(0, 10);
  const [doneOn, setDoneOn] = useState(day);
  const [label, setLabel] = useState('');
  const [minutes, setMinutes] = useState('60');
  const [rate, setRate] = useState('');
  const [parts, setParts] = useState('0');
  const [taxRate, setTaxRate] = useState('18');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = (
    work: () => Promise<{ ok: true; output: unknown } | { ok: false; code: string; facts?: Record<string, string | number> }>,
    then?: (output: unknown) => void,
  ) => {
    setBusy(true);
    setError(null);
    setDone(null);
    void work()
      .then(async (outcome) => {
        if (!outcome.ok) return setError(sayRefusal(outcome.code, outcome.facts));
        then?.(outcome.output);
        await router.invalidate();
      })
      .finally(() => setBusy(false));
  };
  const open = loaded.interventions.filter((one) => !one.invoiceDraftId);
  const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);
  const party = loaded.parties.find((one) => one.partyId === partyId);

  return (
    <Panel title={m.billing_title()}>
      <div className="flex flex-col gap-4">
        {loaded.bill ? (
          <form
            className="grid items-end gap-3 sm:grid-cols-5"
            onSubmit={(event) => {
              event.preventDefault();
              run(() =>
                saveBilling({
                  data: {
                    ticketId,
                    kind,
                    ...(party ? { partyId: party.partyId, partyName: party.name } : {}),
                    ...(!party && partyName.trim() ? { partyName: partyName.trim() } : {}),
                    ...(projectId ? { projectId } : {}),
                    ...(kind === 'contract' && contract.trim() ? { contractReference: contract.trim() } : {}),
                  },
                }),
              );
            }}
          >
            <SelectField
              label={m.billing_kind()}
              value={kind}
              options={billingKinds.map((one) => ({ value: one, label: kindLabel(one) }))}
              onChange={(event) => setKind(event.target.value as BillingKind)}
            />
            {loaded.parties.length > 0 ? (
              <SelectField
                label={m.billing_client()}
                value={partyId}
                options={[
                  { value: '', label: m.billing_client_choose() },
                  ...loaded.parties.map((one) => ({ value: one.partyId, label: one.name })),
                ]}
                onChange={(event) => setPartyId(event.target.value)}
              />
            ) : (
              <TextField label={m.billing_client()} value={partyName} maxLength={200} onChange={(event) => setPartyName(event.target.value)} />
            )}
            <SelectField
              label={m.billing_project()}
              value={projectId}
              options={[
                { value: '', label: m.billing_project_none() },
                ...loaded.projects.map((one) => ({ value: one.projectId, label: one.name })),
              ]}
              onChange={(event) => setProjectId(event.target.value)}
            />
            {kind === 'contract' ? (
              <TextField label={m.billing_contract_ref()} value={contract} maxLength={80} onChange={(event) => setContract(event.target.value)} />
            ) : (
              <span />
            )}
            <Button type="submit" variant="secondary" disabled={busy}>
              {m.billing_save()}
            </Button>
          </form>
        ) : (
          <p>{loaded.billing ? kindLabel(loaded.billing.kind) : m.billing_unset()}</p>
        )}
        {loaded.billing && (
          <p className="text-body-sm text-fg-muted">
            {m.billing_now({
              kind: kindLabel(loaded.billing.kind),
              client: loaded.billing.partyName ?? '—',
              project: loaded.billing.projectName ?? '—',
            })}
          </p>
        )}

        <table className="w-full text-body-sm">
          <caption className="sr-only">{m.interventions_title()}</caption>
          <thead>
            <tr className="text-left text-fg-muted">
              <th>{m.intervention_day()}</th>
              <th>{m.intervention_label()}</th>
              <th className="text-right">{m.intervention_minutes()}</th>
              <th className="text-right">{m.intervention_amount()}</th>
              <th>{m.intervention_invoice()}</th>
            </tr>
          </thead>
          <tbody>
            {loaded.interventions.length === 0 && (
              <tr>
                <td colSpan={5} className="py-2 text-fg-muted">
                  {m.interventions_none()}
                </td>
              </tr>
            )}
            {loaded.interventions.map((one) => (
              <tr key={one.interventionId} className="border-t border-line">
                <td className="py-1">{one.doneOn}</td>
                <td>{one.label}</td>
                <td className="text-right">{one.minutes}</td>
                <td className="text-right">{shown(one.amount)}</td>
                <td>
                  {one.invoiceDraftId ? (
                    loaded.reviewBase ? (
                      <a className="text-link underline" href={`${loaded.reviewBase}${one.invoiceDraftId}`}>
                        {m.intervention_prepared()}
                      </a>
                    ) : (
                      <Tag tone="validated">{m.intervention_prepared()}</Tag>
                    )
                  ) : (
                    <Tag tone="neutral">{m.intervention_open()}</Tag>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {loaded.bill && (
          <form
            className="grid items-end gap-3 sm:grid-cols-6"
            onSubmit={(event) => {
              event.preventDefault();
              const mins = whole(minutes);
              const hourly = whole(rate);
              const spare = whole(parts) ?? 0;
              if (mins === null || hourly === null || !label.trim()) return;
              run(
                () =>
                  addIntervention({
                    data: { ticketId, doneOn, label: label.trim(), minutes: mins, hourlyRate: hourly, parts: spare },
                  }),
                () => setLabel(''),
              );
            }}
          >
            <TextField label={m.intervention_day()} type="date" value={doneOn} onChange={(event) => setDoneOn(event.target.value)} />
            <TextField className="sm:col-span-2" label={m.intervention_label()} value={label} maxLength={300} onChange={(event) => setLabel(event.target.value)} />
            <TextField label={m.intervention_minutes()} inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} />
            <TextField label={m.intervention_rate()} inputMode="numeric" value={rate} onChange={(event) => setRate(event.target.value)} />
            <TextField label={m.intervention_parts()} inputMode="numeric" value={parts} onChange={(event) => setParts(event.target.value)} />
            <div className="sm:col-span-6">
              <Button type="submit" variant="secondary" disabled={busy || !label.trim() || whole(rate) === null}>
                {m.intervention_add()}
              </Button>
            </div>
          </form>
        )}

        {loaded.bill && loaded.billing?.kind === 'billable' && open.length > 0 && (
          <div className="flex flex-wrap items-end gap-3">
            <TextField label={m.invoice_tax()} inputMode="decimal" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} />
            <Button
              disabled={busy || !loaded.finance}
              onClick={() =>
                run(
                  () => prepareInvoice({ data: { ticketId, taxRate: Number(taxRate.replace(',', '.')) || 0 } }),
                  (output) => setDone((output as { reviewUrl: string }).reviewUrl),
                )
              }
            >
              {m.invoice_prepare()}
            </Button>
            {!loaded.finance && <p className="text-body-sm text-fg-muted">{m.billing_error_not_connected()}</p>}
          </div>
        )}
        {done && (
          <p role="status" className="text-body-sm">
            {m.invoice_prepared_note()}{' '}
            <a className="text-link underline" href={done}>
              {m.invoice_open_in_finance()}
            </a>
          </p>
        )}
        {error && (
          <p role="alert" className="text-body-sm text-state-error-fg">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}
