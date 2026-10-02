import * as m from '@/paraglide/messages.js';
import type { TicketScreen } from '../functions';
import type { Criticality } from '../domain/criticality';

/** The words of a ticket's criticality and status, in the person's language. */
export function criticalityLabel(criticality: Criticality): string {
  return {
    critical: m.criticality_critical,
    major: m.criticality_major,
    standard: m.criticality_standard,
    minor: m.criticality_minor,
  }[criticality]();
}

export function statusLabel(status: TicketScreen['status']): string {
  return {
    received: m.status_received,
    acknowledged: m.status_acknowledged,
    suspended: m.status_suspended,
    restored: m.status_restored,
    closed: m.status_closed,
    withdrawn: m.status_withdrawn,
  }[status]();
}
