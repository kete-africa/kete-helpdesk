import { Button, KpiGrid, KpiTile, PageHeader, Panel, Tag, TextField } from '@kete/design';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { fetchIndicators, publishIndicator } from '@/features/tickets/functions';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

/** The current quarter by default: « T4 2026 », from its first to its last day. */
function currentQuarter() {
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3);
  const year = now.getUTCFullYear();
  const pad = (n: number) => String(n).padStart(2, '0');
  const last = new Date(Date.UTC(year, q * 3 + 3, 0)).getUTCDate();
  return {
    label: `T${q + 1} ${year}`,
    from: `${year}-${pad(q * 3 + 1)}-01`,
    to: `${year}-${pad(q * 3 + 3)}-${pad(last)}`,
  };
}

export const Route = createFileRoute('/indicateurs')({
  // Each bound may be left out: the current quarter fills it.
  validateSearch: (search: Record<string, unknown>): { label?: string; from?: string; to?: string } => {
    const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
    const given = { label: text(search['label']), from: text(search['from']), to: text(search['to']) };
    return Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined));
  },
  beforeLoad: ({ location }) => requirePerson(location.href),
  loaderDeps: ({ search }) => ({ ...currentQuarter(), ...search }),
  loader: ({ deps }) => fetchIndicators({ data: deps }),
  component: IndicatorsPage,
});

/**
 * The queues' indicators for a period, from the tickets restored in it: within target, reopened.
 * Sent to Kete Enterprise as readings — management control there takes them, or not.
 */
function IndicatorsPage() {
  const search = { ...currentQuarter(), ...Route.useSearch() };
  const data = Route.useLoaderData();
  const navigate = useNavigate({ from: '/indicateurs' });
  const [period, setPeriod] = useState(search);
  const [notice, setNotice] = useState<string | null>(null);
  const percent = (value: number | null) => (value === null ? '—' : `${value} %`);
  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <PageHeader title={m.indicators_title()} description={m.indicators_explain()} />
        <Panel>
          <div className="flex flex-wrap items-end gap-3">
            <TextField label={m.indicators_label()} value={period.label} onChange={(e) => setPeriod({ ...period, label: e.target.value })} />
            <TextField label={m.indicators_from()} type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
            <TextField label={m.indicators_to()} type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
            <Button variant="secondary" onClick={() => void navigate({ search: period })}>{m.indicators_show()}</Button>
          </div>
        </Panel>
        {data.queues.map((q) => (
          <Panel key={q.queueId} title={q.name}>
            <KpiGrid label={q.name}>
              <KpiTile label={m.indicators_restored()} value={q.restored} />
              <KpiTile label={m.indicators_within()} value={percent(q.rate)} />
              <KpiTile label={m.indicators_reopened()} value={percent(q.reopenRate)} />
            </KpiGrid>
            <div className="mt-3 flex flex-wrap gap-2">
              {q.indicators.map((name) => <Tag key={name}>{name}</Tag>)}
            </div>
            {data.manages && data.connected && q.indicators.length > 0 && (
              <div className="mt-3">
                <Button
                  disabled={q.rate === null}
                  onClick={() => {
                    setNotice(null);
                    void publishIndicator({ data: { ...search, queueId: q.queueId } }).then((answer) =>
                      setNotice(answer.ok ? m.indicators_sent({ count: String(answer.sent) }) : m.indicators_not_sent({ error: answer.error ?? '' })),
                    );
                  }}
                >
                  {m.indicators_send()}
                </Button>
              </div>
            )}
          </Panel>
        ))}
        {!data.connected && <p className="text-body-sm text-fg-muted">{m.indicators_not_connected()}</p>}
        {notice && <p role="status" className="text-body-sm">{notice}</p>}
      </div>
    </AppShell>
  );
}
