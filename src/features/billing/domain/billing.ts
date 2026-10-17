import { RuleError } from '@kete/capabilities';
import { add, money, multiply } from '@kete/money';

// Who pays for a ticket, and what an intervention costs — pure, tested alone. Every amount is an
// integer of the currency's smallest unit (@kete/money).

/** A rule of billing a gesture broke: the screen words its code. */
export class BillingRuleError extends RuleError {
  constructor(
    override readonly code:
      | 'ticket_not_found'
      | 'not_billable'
      | 'client_required'
      | 'nothing_to_invoice'
      | 'finance_not_connected'
      | 'finance_refused'
      | 'refused_by_policy'
      | 'approval_required',
    facts: Record<string, string | number> = {},
  ) {
    super(code, facts);
    this.name = 'BillingRuleError';
  }
}

export { billingKinds, type BillingKind } from './kinds';

/** What an intervention costs: its time at the hourly rate, rounded once, and its parts. */
export function costOf(
  intervention: { minutes: number; hourlyRate: number; parts: number },
  currency: string,
): number {
  const time = multiply(money(intervention.hourlyRate, currency), intervention.minutes / 60);
  return add(time, money(intervention.parts, currency)).amount;
}
