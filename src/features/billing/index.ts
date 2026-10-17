// The billing feature's only door: who pays for a ticket, its interventions, its invoice in Kete
// Finance (Support spec 005).
export {
  billingCapabilities,
  billingEvents,
  billingPermissions,
  billingInput,
  currencyIn,
  interventionInput,
  invoiceAsk,
} from './billing';
export { billingKinds, type BillingKind } from './domain/billing';
export { financeUrl, useFinance } from './finance';
export {
  billingMigrationSql,
  billingOf,
  interventionsOf,
  type Billing,
  type Intervention,
} from './infrastructure/billing.table';
