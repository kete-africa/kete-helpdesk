import type { KeteIdentity } from '@kete/auth';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ticketPermissions } from '@/features/tickets';

export type Role = 'owner' | 'admin' | 'member';

/** What each organization role may do: each feature declares its own permissions. */
const permissionsByRole: Record<Role, Set<string>> = {
  // The organization's journal: who did what, agents included (@kete/admin).
  owner: new Set([...ticketPermissions.owner, 'journal:read']),
  admin: new Set([...ticketPermissions.admin, 'journal:read']),
  member: new Set(ticketPermissions.member),
};

const current = new AsyncLocalStorage<{ identity: KeteIdentity | null }>();

/** Runs `work` for this person: every right checked within it is hers. */
export function asPerson<T>(identity: KeteIdentity | null, work: () => T): T {
  return current.run({ identity }, work);
}

export function currentIdentity(): KeteIdentity | null {
  return current.getStore()?.identity ?? null;
}

/**
 * Whether the person of this request holds `permission` in her organization. An agent acting for
 * her runs within her request: it never has more rights than she has (doctrine).
 */
export function holds(permission: string): boolean {
  const role = currentIdentity()?.role;
  return role ? permissionsByRole[role].has(permission) : false;
}
