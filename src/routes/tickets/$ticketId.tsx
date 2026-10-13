import { Button, EmptyState, PageHeader, Panel, Tag, TextField } from '@kete/design';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { fetchBilling } from '@/features/billing/functions';
import { BillingPanel } from '@/features/billing/ui/BillingPanel';
import { fetchTicket, moveTicket } from '@/features/tickets/functions';
import { AppShell } from '@/lib/shell';
import { requirePerson } from '@/lib/signed-in';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { criticalityLabel, statusLabel } from '@/features/tickets/ui/labels';

export const Route = createFileRoute('/tickets/$ticketId')({
  beforeLoad: ({ location }) => requirePerson(location.href),
  loader: async ({ params }) => ({
    ticket: await fetchTicket({ data: { ticketId: params.ticketId } }),
    billing: await fetchBilling({ data: { ticketId: params.ticketId } }),
  }),
  component: TicketPage,
});

type Step = 'acknowledge' | 'suspend' | 'resume' | 'restore' | 'close' | 'reopen' | 'withdraw';

function refusal(code: string | null): string {
  return (
    {
      wrong_step: m.ticket_error_wrong_step,
      too_late: m.ticket_error_too_late,
      reason_required: m.ticket_error_reason,
      forbidden: m.ticket_error_forbidden,
    }[code ?? ''] ?? m.error_generic
  )();
}

/** One ticket: its clock — from acknowledgement to restoration, suspensions out — and its steps. */
function TicketPage() {
  const { ticket, billing } = Route.useLoaderData();
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const when = (value: string | null) =>
    value ? new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
  const move = (step: Step) => {
    if (!ticket) return;
    setError(null);
    void moveTicket({ data: { ticketId: ticket.ticketId, step, ...(reason.trim() ? { reason } : {}) } }).then(async (answer) => {
      if (!answer.ok) return setError(refusal(answer.error));
      setReason('');
      await router.invalidate();
    });
  };
  const steps: Record<string, Step[]> = {
    received: ['acknowledge', 'withdraw'],
    acknowledged: ['suspend', 'restore'],
    suspended: ['resume'],
    restored: ['close', 'reopen'],
    closed: ['reopen'],
  };
  const stepLabel: Record<Step, () => string> = {
    acknowledge: m.step_acknowledge,
    suspend: m.step_suspend,
    resume: m.step_resume,
    restore: m.step_restore,
    close: m.step_close,
    reopen: m.step_reopen,
    withdraw: m.step_withdraw,
  };
  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        {!ticket ? (
          <EmptyState
            title={m.ticket_not_found()}
            action={
              <a href="/tickets" className="text-link underline">
                {m.ticket_back()}
              </a>
            }
          />
        ) : (
          <>
            <PageHeader
              breadcrumbLabel={m.common_breadcrumb()}
              breadcrumbs={[{ label: m.nav_tickets(), href: '/tickets' }]}
              title={ticket.title}
              status={
                <>
                  <Tag>{criticalityLabel(ticket.criticality)}</Tag>
                  <Tag tone="info">{statusLabel(ticket.status)}</Tag>
                </>
              }
            />
            <Panel>
              <dl className="grid gap-2 text-body-sm sm:grid-cols-2">
                <div><dt className="text-fg-muted">{m.ticket_queue_label()}</dt><dd>{ticket.queueName}</dd></div>
                <div><dt className="text-fg-muted">{m.ticket_requester()}</dt><dd>{ticket.requesterName}</dd></div>
                <div><dt className="text-fg-muted">{m.ticket_received()}</dt><dd>{when(ticket.receivedAt)}</dd></div>
                <div><dt className="text-fg-muted">{m.ticket_acknowledged()}</dt><dd>{when(ticket.acknowledgedAt)}{ticket.assigneeName ? ` · ${ticket.assigneeName}` : ''}</dd></div>
                <div><dt className="text-fg-muted">{m.ticket_restored()}</dt><dd>{when(ticket.restoredAt)}</dd></div>
                <div><dt className="text-fg-muted">{m.ticket_clock()}</dt>
                  <dd>
                    {m.ticket_clock_value({
                      elapsed: ticket.elapsedMinutes === null ? '—' : String(Math.round((ticket.elapsedMinutes / 60) * 10) / 10),
                      target: String(ticket.targetHours),
                      suspended: String(ticket.suspendedMinutes),
                    })}{' '}
                    {ticket.withinTarget === true && <Tag tone="validated">{m.ticket_within()}</Tag>}
                    {ticket.withinTarget === false && <Tag tone="error">{m.ticket_late()}</Tag>}
                  </dd>
                </div>
              </dl>
              {ticket.description && <p className="mt-3 whitespace-pre-line">{ticket.description}</p>}
              {ticket.suspendReason && <p className="mt-2 text-body-sm text-fg-muted">{m.ticket_suspend_reason({ reason: ticket.suspendReason })}</p>}
            </Panel>
            <Panel title={m.ticket_steps()}>
              {ticket.status === 'acknowledged' && (
                <TextField className="mb-3" label={m.ticket_reason()} hint={m.ticket_reason_hint()} value={reason} onChange={(e) => setReason(e.target.value)} />
              )}
              <div className="flex flex-wrap gap-2">
                {(steps[ticket.status] ?? []).map((step) => (
                  <Button key={step} variant={step === 'restore' || step === 'acknowledge' ? 'primary' : 'secondary'} onClick={() => move(step)}>
                    {stepLabel[step]()}
                  </Button>
                ))}
              </div>
              {error && <p role="alert" className="mt-2 text-body-sm text-state-error-fg">{error}</p>}
            </Panel>
            {billing && <BillingPanel ticketId={ticket.ticketId} loaded={billing} />}
          </>
        )}
      </div>
    </AppShell>
  );
}
