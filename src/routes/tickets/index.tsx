import {
  Button,
  CommandBar,
  DataTable,
  Drawer,
  EmptyState,
  KpiGrid,
  KpiTile,
  PageHeader,
  Tag,
  TextField,
  type TagTone,
} from '@kete/design';
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
  'h-(--control-height) rounded-control border border-line-control bg-surface-control px-(--control-padding) font-normal';

/**
 * The open tickets, most critical first, as a table; opening a ticket and creating a queue open
 * in a side panel (the page slots of the workspace design).
 */
function TicketsPage() {
  const board = Route.useLoaderData();
  const router = useRouter();
  const [panel, setPanel] = useState<'ticket' | 'queue' | null>(null);
  const [draft, setDraft] = useState({
    queueId: board.queues[0]?.queueId ?? '',
    title: '',
    description: '',
    criticality: 'standard' as Criticality,
  });
  const [queue, setQueue] = useState({ name: '', indicators: '' });
  const count = (c: Criticality) => board.tickets.filter((t) => t.criticality === c).length;
  return (
    <AppShell>
      <PageHeader
        title={m.tickets_title()}
        actions={
          <>
            {board.manages && (
              <Button variant="secondary" onClick={() => setPanel('queue')}>
                {m.queue_new()}
              </Button>
            )}
            {board.queues.length > 0 && (
              <Button onClick={() => setPanel('ticket')}>{m.ticket_new()}</Button>
            )}
          </>
        }
      />
      <KpiGrid label={m.ticket_criticality_label()}>
        {criticalities.map((c) => (
          <KpiTile key={c} label={criticalityLabel(c)} value={count(c)} />
        ))}
      </KpiGrid>
      <CommandBar />
      {board.tickets.length === 0 ? (
        <EmptyState title={m.tickets_empty_title()}>{m.tickets_empty_body()}</EmptyState>
      ) : (
        <DataTable
          caption={m.tickets_table_title()}
          rows={board.tickets}
          rowKey={(t) => t.ticketId}
          rowHref={(t) => `/tickets/${t.ticketId}`}
          columns={[
            { key: 'title', label: m.ticket_title_label() },
            {
              key: 'criticality',
              label: m.ticket_criticality_label(),
              render: (t) => <Tag tone={tone[t.criticality]}>{criticalityLabel(t.criticality)}</Tag>,
            },
            { key: 'queueName', label: m.ticket_queue_label() },
            { key: 'status', label: m.ticket_status_label(), render: (t) => statusLabel(t.status) },
            {
              key: 'assignee',
              label: m.ticket_acknowledged(),
              render: (t) => t.assigneeName ?? '—',
            },
          ]}
        />
      )}
      <Drawer
        open={panel === 'ticket'}
        onClose={() => setPanel(null)}
        title={m.ticket_new()}
        closeLabel={m.common_close()}
        footer={
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
              setPanel(null);
              await router.invalidate();
            }}
          >
            {m.ticket_open()}
          </Button>
        }
      >
        <div className="grid gap-4">
          <label className="flex flex-col gap-1.5 text-body-sm font-semibold">
            {m.ticket_queue_label()}
            <select
              className={field}
              value={draft.queueId}
              onChange={(e) => setDraft({ ...draft, queueId: e.target.value })}
            >
              {board.queues.map((q) => (
                <option key={q.queueId} value={q.queueId}>
                  {q.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-body-sm font-semibold">
            {m.ticket_criticality_label()}
            <select
              className={field}
              value={draft.criticality}
              onChange={(e) => setDraft({ ...draft, criticality: e.target.value as Criticality })}
            >
              {criticalities.map((c) => (
                <option key={c} value={c}>
                  {criticalityLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <p className="text-body-sm text-fg-muted">{m.criticality_explain()}</p>
          <TextField
            label={m.ticket_title_label()}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <label className="flex flex-col gap-1.5 text-body-sm font-semibold">
            {m.ticket_description_label()}
            <textarea
              className="min-h-24 rounded-control border border-line-control bg-surface-control p-3 font-normal"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>
        </div>
      </Drawer>
      {board.manages && (
        <Drawer
          open={panel === 'queue'}
          onClose={() => setPanel(null)}
          title={m.queue_new()}
          closeLabel={m.common_close()}
          footer={
            <Button
              disabled={!queue.name.trim()}
              onClick={async () => {
                await addQueue({
                  data: {
                    name: queue.name,
                    indicators: queue.indicators
                      .split(/\r?\n/)
                      .map((x) => x.trim())
                      .filter(Boolean),
                  },
                });
                setQueue({ name: '', indicators: '' });
                setPanel(null);
                await router.invalidate();
              }}
            >
              {m.queue_create()}
            </Button>
          }
        >
          <div className="grid gap-4">
            <TextField
              label={m.queue_name()}
              value={queue.name}
              onChange={(e) => setQueue({ ...queue, name: e.target.value })}
            />
            <label className="flex flex-col gap-1.5 text-body-sm font-semibold">
              {m.queue_indicators()}
              <textarea
                className="min-h-24 rounded-control border border-line-control bg-surface-control p-3 font-normal"
                value={queue.indicators}
                onChange={(e) => setQueue({ ...queue, indicators: e.target.value })}
              />
            </label>
            <p className="text-body-sm text-fg-muted">{m.queue_indicators_hint()}</p>
          </div>
        </Drawer>
      )}
    </AppShell>
  );
}
