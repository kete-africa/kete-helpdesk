import type { KeteIdentity } from '@kete/auth';
import { performGesture } from '@kete/capabilities';
import { insertQueue } from '@/features/tickets/infrastructure/ticket.table';
import { transaction } from '@/platform/db';
import { registry } from '@/platform/registry';
import { asPerson } from '@/platform/rights';
import { screenActor } from '@/platform/session';

// The demonstration's data: the after-sales desk of a solar installer — its queues, the tickets its
// clients opened, a billable intervention ready to invoice in Kete Finance. Written through the
// app's own gestures, as its people would.

// Joined to a Compte Kete on this machine (kete-core's `pnpm platform`): its organization.
const joined = process.env.KETE_DEMO_JOINED === 'on';
export const DEMO_ORGANIZATION = (joined && process.env.KETE_DEMO_ORGANIZATION) || 'org_demo_support';

const person = (userId: string, name: string, role: KeteIdentity['role']): KeteIdentity => ({
  userId,
  email: `${userId}@example.test`,
  name,
  organizationId: DEMO_ORGANIZATION,
  role,
  apps: {},
  twoFactor: false,
  expiresAt: new Date(Date.now() + 8 * 3_600_000),
});

/** Who the demonstration can be opened as: the head of after-sales, and a technician. */
export const demoPeople = {
  // Joined: the person signed in through the Compte Kete is the head of after-sales.
  owner: person((joined && process.env.KETE_DEMO_ME) || 'usr_demo_abla', 'Abla Nyuiadzi', 'owner'),
  technician: person('usr_demo_koffi', 'Koffi Amouzou', 'member'),
} as const;
export type DemoRole = keyof typeof demoPeople;

async function act<T = Record<string, unknown>>(who: KeteIdentity, name: string, input: unknown) {
  const outcome = await performGesture<T>(
    registry,
    { actor: screenActor(who), organizationId: DEMO_ORGANIZATION, name, input },
    (work) => asPerson(who, work),
  );
  if (!outcome.ok) throw new Error(`${name}: ${outcome.code}`);
  return outcome.output;
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

export async function seedDemo(): Promise<void> {
  const { owner } = demoPeople;
  const queues = await transaction(DEMO_ORGANIZATION, async (db) => ({
    inverters: await insertQueue(db, DEMO_ORGANIZATION, { name: 'Onduleurs et batteries', indicators: [] }),
    installs: await insertQueue(db, DEMO_ORGANIZATION, { name: 'Installations', indicators: [] }),
  }));
  // Opened at the desk for the client who called: the client's name is the requester's.
  const open = (queueId: string, title: string, criticality: string, description: string) =>
    act<{ ticketId: string }>(owner, 'tickets_open', {
      queueId,
      title,
      criticality,
      description,
      requesterName: title.split(' — ')[1] ?? owner.name,
    });
  await open(
    queues.inverters.queueId,
    'Onduleur arrêté — Garage Bè',
    'critical',
    'L’onduleur du garage s’est encore arrêté ce matin ; le client attend un passage.',
  );
  const sarakawa = await open(
    queues.inverters.queueId,
    'Onduleur en défaut — Hôtel Sarakawa',
    'major',
    'Alarme de surchauffe depuis lundi, hors garantie.',
  );
  const biasa = await open(
    queues.installs.queueId,
    'Panneau fissuré — Clinique Biasa',
    'standard',
    'Un panneau de la rangée nord fissuré après l’orage ; sous garantie.',
  );
  await open(queues.installs.queueId, 'Câbles à reprendre — École de Bè', 'minor', 'Gaines abîmées.');
  // Who pays: the hotel is billed, the clinic is under warranty.
  await act(owner, 'tickets_set_billing', {
    ticketId: sarakawa.ticketId,
    kind: 'billable',
    partyName: 'Hôtel Sarakawa',
  });
  await act(owner, 'interventions_record', {
    ticketId: sarakawa.ticketId,
    doneOn: day(-1),
    label: 'Diagnostic et remplacement du ventilateur',
    minutes: 90,
    hourlyRate: 15_000,
    parts: 42_000,
  });
  await act(owner, 'tickets_set_billing', { ticketId: biasa.ticketId, kind: 'warranty' });
}
