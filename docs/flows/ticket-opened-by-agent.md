# An agent opens a ticket for a person

```mermaid
sequenceDiagram
  participant P as Person (member)
  participant C as Copilot
  participant A as kete-helpdesk /mcp
  P->>C: "The inverter of the Lomé site is down"
  C->>A: tickets_open (level 2) for the person
  A->>A: holds tickets:write? the person's rights, never more
  A->>A: open-ticket, journaled: agent for the person, through mcp
  A-->>C: done · undo: withdraw-ticket
  C->>A: tickets_list (level 1)
  A-->>C: a table view of the open tickets
```

Opening is level 2: it commits nothing irreversible, since a ticket nobody has acknowledged yet
can be withdrawn. Every later step is taken by a person on the ticket's screen.
