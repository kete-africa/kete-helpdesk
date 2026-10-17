import type { AppGesture, GestureVerdict } from '@kete/center';
import type { Actor } from '@kete/commands';
import { getCenter } from './center';

// A gesture passed through the organization's policies before the app makes it (kete-core spec
// 114; doctrine D-058): one engine at the center, the same for the person and for her agent. What
// the organization wrote decides; where it wrote nothing — or without a center — the app keeps its
// own rules.

/**
 * The policies' verdict for a gesture of this person or her agent. `refuse` stops it with the
 * policies' sentences; `approve` names who approves; `unruled` leaves it to the app's own rules.
 */
export function passGesture(
  token: string | null | undefined,
  actor: Pick<Actor, 'kind' | 'id'>,
  gesture: Omit<AppGesture, 'agent'>,
): Promise<GestureVerdict> {
  return getCenter().checkGesture(token, {
    ...gesture,
    ...(actor.kind === 'agent' ? { agent: { id: actor.id } } : {}),
  });
}

/** The sentences of the policies that decided, as the person reads them. */
export const sentencesOf = (verdict: GestureVerdict): string =>
  verdict.policies.map((p) => p.sentence).join(' · ');
