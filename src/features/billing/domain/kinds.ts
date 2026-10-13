/**
 * Who pays: nobody under the warranty of what was sold, the client's contract when it covers the
 * intervention, the client otherwise. Alone, so a screen reads it without the rules.
 */
export const billingKinds = ['warranty', 'contract', 'billable'] as const;
export type BillingKind = (typeof billingKinds)[number];
