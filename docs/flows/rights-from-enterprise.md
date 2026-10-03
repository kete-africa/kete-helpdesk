# Rights granted in Kete Enterprise

Support declares its permissions in `features/tickets/policies.ts`, with their words in French and
English and the Compte Kete roles that hold them by default (kete-core spec 049). Kete Enterprise
reads them from the card; an administrator puts them in roles, granted to positions.

```mermaid
sequenceDiagram
  participant P as Person (screen, copilot or app)
  participant S as Support
  participant E as Kete Enterprise
  P->>S: a gesture, with her token
  S->>E: GET /v1/apps/prd_kete_helpdesk/grants (her token)
  alt Support's rights managed there
    E-->>S: managed: true · tickets:manage on the SAV unit
    S->>S: her grants decide
  else not managed, not connected, or no answer
    S->>S: her last grants known (24 h), else her role's defaults
  end
```

| Permission       | By default            | What it allows                                       |
| ---------------- | --------------------- | ---------------------------------------------------- |
| `tickets:read`   | owner, admin, member  | the queues' tickets, their steps and deadlines       |
| `tickets:write`  | owner, admin, member  | open, acknowledge, suspend, restore a ticket         |
| `tickets:manage` | owner, admin          | queues, their indicators, readings to Kete Enterprise |
| `journal:read`   | owner, admin          | who did what, agents included                        |
