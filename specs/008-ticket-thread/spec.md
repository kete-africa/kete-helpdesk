# Spec 008 — A ticket's thread, beside the ticket

Kete Enterprise keeps a thread for each ticket (its spec 098): born when the ticket is opened, where
the technician, the requester's side and Kete talk about it. Until now Support only linked to it
(« Fil du ticket »). Doctrine D-061 wants the conversation where the work is: the ticket's thread is
read and answered in the ticket's page, drawn as everywhere by `@kete/conversation` (kete-core spec
141).

## Requirements

- **FR-001 — Read beside the ticket.** The ticket's page shows its thread at the center: its last
  messages as « Fils » shows them to the person (what she may read), read again every 15 seconds,
  with « Ouvrir dans Fils » for the rest.
- **FR-002 — Answered there.** She writes in it with the one composer (`@kete/design`'s
  `MessageField`, her draft kept per ticket); every member reads it in « Fils ».
- **FR-003 — Alone without a center.** Without Kete Enterprise there is no thread: the page says so,
  and the ticket works as before.

## Proof

- The ticket's page reads and answers its thread on the joined platform.
