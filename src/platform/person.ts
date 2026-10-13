import type { Actor } from '@kete/commands';
import { AsyncLocalStorage } from 'node:async_hooks';

// Who a request is for, for what a gesture must ask the center while it runs: her own token —
// never sent to a browser — and her name, as a document she writes shows it. Kept apart from the
// rights so that a feature may read them without knowing how rights are computed.

const current = new AsyncLocalStorage<{ token: string | null; name: string | null }>();

export function withPerson<T>(
  person: { token?: string | null | undefined; name?: string | null | undefined },
  work: () => T | Promise<T>,
): T | Promise<T> {
  return current.run({ token: person.token ?? null, name: person.name ?? null }, work);
}

/** The token of the person of this request; null in a worker, or without a center's sign-in. */
export function currentToken(): string | null {
  return current.getStore()?.token ?? null;
}

/** Her name, or her identifier when the request does not carry one. */
export function currentName(fallback: string): string {
  return current.getStore()?.name ?? fallback;
}

/** The person a gesture is made for: herself, or who an agent or an app acts for. */
export function actingFor(actor: Actor): string {
  return actor.onBehalfOf?.id ?? actor.id;
}
