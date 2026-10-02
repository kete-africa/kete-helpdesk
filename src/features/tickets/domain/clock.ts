import type { TicketStatus } from '../ticket.record';
import { targetHours, type Criticality } from './criticality';

/**
 * The rules of a ticket and of its clock, pure: no database, no framework, tested alone. The clock
 * starts at acknowledgement and stops at restoration — never at an administrative closing; a
 * suspension, dated and motivated, does not count (annex B).
 */
export class TicketRuleError extends Error {
  constructor(
    readonly code: 'not_found' | 'wrong_step' | 'too_late' | 'reason_required',
  ) {
    super(code);
    this.name = 'TicketRuleError';
  }
}

const allowed: Record<string, TicketStatus[]> = {
  acknowledge: ['received'],
  withdraw: ['received'],
  suspend: ['acknowledged'],
  resume: ['suspended'],
  restore: ['acknowledged'],
  close: ['restored'],
  reopen: ['restored', 'closed'],
};

export type Step = keyof typeof allowed;

export function check(step: Step, status: TicketStatus): void {
  if (!(allowed[step] ?? []).includes(status)) throw new TicketRuleError('wrong_step');
}

/** A ticket may be reopened within seven days of its restoration; after, it is a new one. */
export function mayReopen(restoredAt: Date | null, now: Date): boolean {
  return restoredAt !== null && now.getTime() - restoredAt.getTime() <= 7 * 86_400_000;
}

/** Minutes the clock ran: from acknowledgement to restoration, suspensions left out. */
export function elapsedMinutes(ticket: {
  acknowledgedAt: Date | null;
  restoredAt: Date | null;
  suspendedMinutes: number;
}): number | null {
  if (!ticket.acknowledgedAt || !ticket.restoredAt) return null;
  const minutes = (ticket.restoredAt.getTime() - ticket.acknowledgedAt.getTime()) / 60_000;
  return Math.max(0, Math.round(minutes - ticket.suspendedMinutes));
}

/** Whether a restored ticket was restored within its criticality's target. */
export function withinTarget(ticket: {
  criticality: Criticality;
  acknowledgedAt: Date | null;
  restoredAt: Date | null;
  suspendedMinutes: number;
}): boolean | null {
  const minutes = elapsedMinutes(ticket);
  return minutes === null ? null : minutes <= targetHours[ticket.criticality] * 60;
}

export interface QueueIndicators {
  restored: number;
  withinTarget: number;
  /** Share restored within target, on 100; null without a restored ticket. */
  rate: number | null;
  reopened: number;
  /** Share reopened within seven days, on 100 (above 5 %, the indicator drops one colour). */
  reopenRate: number | null;
}

/** A queue's indicators for a period, from its tickets restored in it. */
export function indicatorsOf(
  tickets: {
    criticality: Criticality;
    acknowledgedAt: Date | null;
    restoredAt: Date | null;
    suspendedMinutes: number;
    reopenCount: number;
  }[],
): QueueIndicators {
  const restored = tickets.filter((t) => t.restoredAt);
  const within = restored.filter((t) => withinTarget(t)).length;
  const reopened = restored.filter((t) => t.reopenCount > 0).length;
  const share = (n: number) =>
    restored.length === 0 ? null : Math.round((n / restored.length) * 1000) / 10;
  return {
    restored: restored.length,
    withinTarget: within,
    rate: share(within),
    reopened,
    reopenRate: share(reopened),
  };
}
