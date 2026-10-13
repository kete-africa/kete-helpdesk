# Spec 005 — Who pays for a ticket

Step **J1** of the plan (Kete Enterprise's roadmap): a ticket knows who pays — the warranty, the
client's contract, or the client — and a billable intervention **prepares an invoice in Kete
Finance**.

## Why

The technician fixes the inverter on Tuesday; the invoice is written on the 30th from memory, or
never. And a repair under warranty is billed by mistake to a client who then disputes everything.

```mermaid
sequenceDiagram
  participant T as Technician (Support)
  participant S as Support
  participant F as Kete Finance
  participant A as Who issues invoices (Kete Finance)
  T->>S: who pays: billable, Hôtel Sarakawa
  T->>S: interventions: 90 min diagnosis; 60 min and a power board
  T->>S: tickets_prepare_invoice (18 %)
  S->>F: POST /api/v1/capabilities/invoices_create (her token)
  F-->>S: a draft — drf_…, verified and issued in Kete Finance
  S->>S: the interventions remember their draft: never prepared twice
  A->>F: verifies the draft, issues F-2026-00xx
```

## What it gives

- **Who pays** for a ticket: warranty, maintenance contract (its reference), or billable to the
  client — the center's third party, and the project when there is one.
- **Interventions**: day, what was done, minutes, hourly rate, parts; their cost computed by
  `@kete/money` (time rounded once, parts added).
- **The invoice prepared in Kete Finance**: the billable ticket's interventions not invoiced yet
  become one draft invoice there — one line for each intervention's time, one for its parts —
  asked with the person's token. Kete Finance answers with a draft (Support is an app acting for
  her: it prepares, a person issues). The interventions keep the draft's identifier; the panel
  links to it. Support never issues an invoice.
- Refused when the ticket is under warranty or contract, when everything is already invoiced,
  when Kete Finance is not connected (`FINANCE_URL`) or refuses — and nothing is marked then.
- A permission, `tickets:bill`; an event, `ticket.invoice_prepared` (amounts, never a name).
- The packages move to the versions the other apps use (`@kete/capabilities` 0.5, `@kete/center`
  0.5, `@kete/design` 0.7, …), and the person's token is kept while a gesture runs
  (`platform/person.ts`), as in the other apps.

## What stays for later

- The intervention's cost told to its project at the center (a fact of money), and the time of a
  warranty intervention counted as the project's cost.
- What the client bought, read from Kete Finance (the warranty's end), so that « warranty » is
  checked rather than said.
- A contract's coverage read from Kete Commitments.
- The draft's state read back (issued, its number) on the ticket.

## Proof

- `tests/billing.test.ts` (6): **a billable intervention prepares an invoice in Kete Finance** —
  asked with her token, one line per intervention and its parts apart, the draft linked; never
  prepared twice, a new intervention a new draft; nothing under warranty; nothing marked when
  Kete Finance refuses; not connected without its address.
- `tests/app.test.ts` (16) still pass on the new packages.
- Not proven: the two apps running together — the test plays Kete Finance's answer, whose own
  tests prove `invoices_create` prepares a draft for an app acting for a person.
