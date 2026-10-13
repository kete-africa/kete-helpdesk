# Billing

Who pays for a ticket, its interventions, and the draft invoice prepared in Kete Finance
(spec 005). `finance.ts` is the port to Kete Finance (`invoices_create` over its API, with the
person's token); `domain/billing.ts` computes an intervention's cost with `@kete/money`.
`prepare-ticket-invoice` marks the interventions with their draft only once Kete Finance answered.
