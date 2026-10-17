import { ticketHoldings, ticketOrganizations } from '@/features/tickets';
import { getCenter } from './center';
import { getPool, transaction } from './db';
import { centerAppToken } from './events';

// What Support holds, said to Kete Enterprise (kete-core spec 114; doctrine D-056): every ticket in
// someone's hands, with who holds it. The center keeps them in « Pour moi », relays them when
// their holder is away and finishes those no longer said. Said all at once: after a step of a
// ticket, and every minute by the worker.

const publicUrl = () => (process.env.PUBLIC_URL ?? '').replace(/\/$/, '') || null;

/** Says what Support holds for one organization; never fails the gesture it follows. */
export async function sayHoldings(organizationId: string): Promise<void> {
  const center = getCenter();
  if (!center.connected) return;
  try {
    const token = await centerAppToken();
    if (!token) return;
    const holdings = await transaction(organizationId, (db) => ticketHoldings(db, publicUrl()));
    const said = await center.sayHoldings(token, organizationId, holdings);
    if (!said.ok) console.warn('[holdings] not said to the center', organizationId, said.error);
  } catch (error) {
    console.warn('[holdings] not said to the center', organizationId, (error as Error).message);
  }
}

/** The worker, every minute: each organization with a ticket still open. */
export async function sayAllHoldings(): Promise<void> {
  if (!getCenter().connected) return;
  for (const organizationId of await ticketOrganizations(getPool())) {
    await sayHoldings(organizationId);
  }
}
