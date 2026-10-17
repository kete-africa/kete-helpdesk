# A ticket's life and its clock

A ticket lands in a queue (after-sales, IT support, general services…) with a criticality chosen
from a grid. Each criticality has its target, from acknowledgement to restoration: critical 4 h,
major 8 h, standard 24 h, minor 120 h (five working days). The clock starts at the
acknowledgement, never at the request, and stops at the restoration of the service, never at the
administrative closing. A suspension waits for a third party or the requester: it is dated and
motivated, and its minutes do not count. A ticket restored less than seven days ago may be
reopened; after, it is a new one. A ticket opened by mistake is withdrawn before anyone takes it.

```mermaid
stateDiagram-v2
  [*] --> received: open-ticket (screen, or an agent for the person)
  received --> withdrawn: withdraw-ticket (the inverse of opening)
  received --> acknowledged: acknowledge-ticket · the clock starts
  acknowledged --> suspended: suspend-ticket · a reason is required
  suspended --> acknowledged: resume-ticket · suspended minutes set aside
  acknowledged --> restored: restore-ticket · the clock stops
  restored --> closed: close-ticket
  restored --> acknowledged: reopen-ticket · within 7 days
  closed --> acknowledged: reopen-ticket · within 7 days
```

Every step is a journaled command (`@kete/commands`), refused when the ticket is not at the step
it needs (`wrong_step`), with the person's rights only.

## The indicators, sent as readings

For each queue and period, the tickets restored in it give two shares: restored within their
criticality's target, and reopened within seven days. A queue names the organization's
indicators it feeds, as they are written in its referential. Someone who manages the queues sends
them to Kete Enterprise as readings, with their own access token: management control there takes
a reading into a review, or not.

```mermaid
sequenceDiagram
  participant M as Queue manager
  participant H as kete-helpdesk
  participant E as Kete Enterprise
  participant C as Management control
  M->>H: /indicateurs · period
  H->>H: indicatorsOf(restored tickets)
  M->>H: Send to Kete Enterprise
  H->>E: POST /v1/performance/readings (person's token, source kete-helpdesk)
  E-->>H: recorded, append-only
  C->>E: review · measure from a reading
```

Without `ENTERPRISE_API_URL`, the indicators stay in the app.

## The ticket in its holder's hands, at Kete Enterprise (spec 006)

A ticket taken is a holding of its assignee at Kete Enterprise (kete-core spec 114): « Rétablir :
… », due on the day of its criticality's deadline (suspensions added). Suspended or restored, it
waits on its requester; closed or withdrawn, it is no longer said and the center finishes it. The
app says every ticket in someone's hands at once, with its own token, after each step and every
minute — the center keeps them in « Pour moi » and relays them when the holder is away. A ticket
nobody took has no holder yet. The central assistant also reaches this app's tools through its MCP
endpoint, with the person's token (Enterprise spec 018).

```mermaid
sequenceDiagram
  participant T as Technician
  participant H as kete-helpdesk
  participant E as Kete Enterprise
  T->>H: Acknowledge
  H->>E: PUT /public/apps/holdings (its own token: every ticket in someone's hands)
  E-->>T: « Pour moi » · due at the deadline
  T->>H: Service restored
  H->>E: PUT /public/apps/holdings (now waiting on the requester)
  T->>H: Closed
  H->>E: PUT /public/apps/holdings (no longer said: finished)
```
