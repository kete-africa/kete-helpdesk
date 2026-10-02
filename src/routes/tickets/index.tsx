import { Button, EmptyState, Panel, Tag, TextField, type TagTone } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { addQueue, addTicket, fetchBoard } from '@/features/tickets/functions';
import { criticalities, type Criticality } from '@/features/tickets/domain/criticality';
import { criticalityLabel, statusLabel } from '@/features/tickets/ui/labels';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';

export const Route = createFileRoute('/tickets')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: () => fetchBoard({ data: { open: true } }),
  component: TicketsPage,
});

const tone: Record<Criticality, TagTone> = {
  critical: 'error',
  major: 'verify',
  standard: 'info',
  minor: 'neutral',
};

const field =
  'h-(--control-height) rounded-control border border-line-control bg-surface-control px-(--control-padding)';

/** The open tickets, most critical first; and the form to open one. */
function TicketsPage() {
  const board = Route.useLoaderData();
  const router = useRouter();
  const [draft, setDraft] = useState({
    queueId: board.queues[0]?.queueId ?? '',
    title: '',
    description: '',
    criticality: 'standard' as Criticality,
  });
  const [queue, setQueue] = useState({ name: '', indicators: '' });
  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <h1 className="font-heading text-headline font-semibold">{m.tickets_title()}</h1>
        {board.queues.length > 0 && (
          <Panel title={m.ticket_new()}>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-body-sm font-semibold">
                {m.ticket_queue_label()}
                <select className={field} value={draft.queueId} onChange={(e) => setDraft({ ...draft, queueId: e.target.value })}>
                  {board.queues.map((q) => (
                    <option key={q.queueId} value={q.queueId}>{q.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-body-sm font-semibold">
                {m.ticket_criticality_label()}
                <select className={field} value={draft.criticality} onChange={(e) => setDraft({ ...draft, criticality: e.target.value as Criticality })}>
                  {criticalities.map((c) => (
                    <option key={c} value={c}>{criticalityLabel(c)}</option>
                  ))}
                </select>
              </label>
              <TextField className="md:col-span-2" label={m.ticket_title_label()} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              <label className="flex flex-col gap-1.5 text-body-sm font-semibold md:col-span-2">
                {m.ticket_description_label()}
                <textarea className="min-h-20 rounded-control border border-line-control bg-surface-control p-3 font-normal" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </label>
            </div>
            <p className="mt-2 text-body-sm text-fg-muted">{m.criticality_explain()}</p>
            <div className="mt-3">
              <Button
                disabled={!draft.title.trim() || !draft.queueId}
                onClick={async () => {
                  await addTicket({
                    data: {
                      queueId: draft.queueId,
                      title: draft.title,
                      criticality: draft.criticality,
                      ...(draft.description.trim() ? { description: draft.description } : {}),
                    },
                  });
                  setDraft({ ...draft, title: '', description: '' });
                  await router.invalidate();
                }}
              >
                {m.ticket_open()}
              </Button>
            </div>
          </Panel>
        )}
        {board.tickets.length === 0 ? (
          <EmptyState title={m.tickets_empty_title()}>{m.tickets_empty_body()}</EmptyState>
        ) : (
          <ul className="grid gap-2">
            {board.tickets.map((t) => (
              <li key={t.ticketId}>
                <a href={`/tickets/${t.ticketId}`} className="flex flex-wrap items-center gap-2 rounded-box border border-line bg-surface px-4 py-3 hover:border-accent">
                  <Tag tone={tone[t.criticality]}>{criticalityLabel(t.criticality)}</Tag>
                  <span className="font-semibold">{t.title}</span>
                  <span className="text-body-sm text-fg-muted">{t.queueName}</span>
                  <Tag>{statusLabel(t.status)}</Tag>
                  {t.assigneeName && <span className="text-body-sm text-fg-muted">{t.assigneeName}</span>}
                </a>
              </li>
            ))}
          </ul>
        )}
        {board.manages && (
          <Panel title={m.queue_new()}>
            <div className="grid gap-3">
              <TextField label={m.queue_name()} value={queue.name} onChange={(e) => setQueue({ ...queue, name: e.target.value })} />
              <label className="flex flex-col gap-1.5 text-body-sm font-semibold">
                {m.queue_indicators()}
                <textarea className="min-h-20 rounded-control border border-line-control bg-surface-control p-3 font-normal" value={queue.indicators} onChange={(e) => setQueue({ ...queue, indicators: e.target.value })} />
              </label>
              <p className="text-body-sm text-fg-muted">{m.queue_indicators_hint()}</p>
              <div>
                <Button
                  variant="secondary"
                  disabled={!queue.name.trim()}
                  onClick={async () => {
                    await addQueue({
                      data: {
                        name: queue.name,
                        indicators: queue.indicators.split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
                      },
                    });
                    setQueue({ name: '', indicators: '' });
                    await router.invalidate();
                  }}
                >
                  {m.queue_create()}
                </Button>
              </div>
            </div>
          </Panel>
        )}
      </div>
    </AppShell>
  );
}
