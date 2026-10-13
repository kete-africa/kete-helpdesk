import type { KeteIdentity } from '@kete/auth';
import { performGesture, type Caller } from '@kete/capabilities';
import { createTestSchema, type TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrations } from '../db/migrations';
import { costOf } from '../src/features/billing/domain/billing';
import { interventionsOf } from '../src/features/billing';
import { insertQueue } from '../src/features/tickets/infrastructure/ticket.table';
import { transaction, usePool } from '../src/platform/db';
import { registry } from '../src/platform/registry';
import { asPerson } from '../src/platform/rights';
import { screenActor } from '../src/platform/session';

// Spec 005 — who pays for a ticket. The proof of step J1: « A billable intervention prepares an
// invoice in Kete Finance » — as a draft, for the person, which is verified and issued there.

const ORG = 'org_acme';
let db: TestSchema;

const ama: KeteIdentity = {
  userId: 'usr_ama',
  email: 'usr_ama@example.test',
  name: 'Ama',
  organizationId: ORG,
  role: 'owner',
  apps: {},
  twoFactor: false,
  expiresAt: new Date(Date.now() + 60_000),
};
const kofi: KeteIdentity = { ...ama, userId: 'usr_kofi', email: 'usr_kofi@example.test', name: 'Kofi', role: 'member' };

const onScreen = (who: KeteIdentity): Caller => ({ actor: screenActor(who), organizationId: ORG });
const gesture = <T = Record<string, unknown>>(who: KeteIdentity, name: string, input: unknown) =>
  performGesture<T>(registry, { ...onScreen(who), name, input }, (work) =>
    asPerson(who, work, `${who.userId}-token`),
  );
const done = <T>(outcome: { ok: true; output: T } | { ok: false; code: string }): T => {
  if (!outcome.ok) throw new Error(`refused: ${outcome.code}`);
  return outcome.output;
};

// Kete Finance, as Support reaches it: what it was asked, with which token, and its answer.
const finance = {
  asked: [] as { url: string; token: string; body: Record<string, unknown> }[],
  refuse: false,
};
function fakeFinance(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith('https://finance.test/')) {
    return Promise.resolve(Response.json({ error: 'not_found' }, { status: 404 }));
  }
  const token = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? '';
  finance.asked.push({ url, token, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
  if (finance.refuse) {
    return Promise.resolve(Response.json({ error: 'not_allowed', status: 'refused', reason: 'not_allowed' }, { status: 403 }));
  }
  return Promise.resolve(
    Response.json(
      { status: 'draft', draftId: `drf_${finance.asked.length}`, message: 'A draft was prepared.' },
      { status: 202 },
    ),
  );
}

const ids = {} as Record<'ticket' | 'warranty', string>;

async function openTicket(title: string): Promise<string> {
  const queue = await transaction(ORG, (tx) => insertQueue(tx, ORG, { name: `File ${title}`, indicators: [] }));
  const ticket = done(
    await gesture<{ ticketId: string }>(ama, 'tickets_open', {
      queueId: queue.queueId,
      title,
      criticality: 'standard',
    }),
  );
  return ticket.ticketId;
}

beforeAll(async () => {
  process.env.FINANCE_URL = 'https://finance.test';
  vi.stubGlobal('fetch', fakeFinance);
  db = await createTestSchema({
    migrate: async (owner, context) => {
      for (const migration of migrations) await owner.query(migration.sql(context));
    },
  });
  usePool(db.app);
  ids.ticket = await openTicket('Onduleur en défaut — Hôtel Sarakawa');
  ids.warranty = await openTicket('Panneau fissuré — Clinique Biasa');
});

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.FINANCE_URL;
  await db.drop();
});

describe('what an intervention costs', () => {
  it('is its time at the hourly rate, rounded once, and its parts', () => {
    expect(costOf({ minutes: 90, hourlyRate: 15_000, parts: 45_000 }, 'XOF')).toBe(67_500);
    expect(costOf({ minutes: 20, hourlyRate: 10_000, parts: 0 }, 'XOF')).toBe(3_333);
  });
});

describe('a billable intervention prepares an invoice in Kete Finance', () => {
  it('records interventions on a ticket the client pays for', async () => {
    // Billable needs its client.
    expect(
      await gesture(ama, 'tickets_set_billing', { ticketId: ids.ticket, kind: 'billable' }),
    ).toMatchObject({ ok: false, code: 'client_required' });
    done(
      await gesture(ama, 'tickets_set_billing', {
        ticketId: ids.ticket,
        kind: 'billable',
        partyId: 'pty_0000000000000000000000000000beef',
        partyName: 'Hôtel Sarakawa',
      }),
    );
    for (const intervention of [
      { doneOn: '2026-10-12', label: 'Diagnostic onduleur', minutes: 90, hourlyRate: 15_000, parts: 0 },
      { doneOn: '2026-10-13', label: 'Remplacement carte de puissance', minutes: 60, hourlyRate: 15_000, parts: 120_000 },
    ]) {
      done(await gesture(ama, 'interventions_record', { ticketId: ids.ticket, ...intervention }));
    }
    // A member without the right does not bill.
    expect(
      await gesture(kofi, 'interventions_record', {
        ticketId: ids.ticket,
        doneOn: '2026-10-13',
        label: 'x',
        minutes: 1,
        hourlyRate: 1,
      }),
    ).toMatchObject({ ok: false, code: 'not_allowed' });
  });

  it('prepares a draft in Kete Finance, for her, with one line per intervention and its parts apart', async () => {
    const prepared = done(
      await gesture<{ draftId: string; reviewUrl: string; amount: number }>(ama, 'tickets_prepare_invoice', {
        ticketId: ids.ticket,
        taxRate: 18,
      }),
    );
    expect(prepared).toMatchObject({
      draftId: 'drf_1',
      reviewUrl: 'https://finance.test/verification/drf_1',
      amount: 22_500 + 135_000,
    });
    expect(finance.asked).toEqual([
      {
        url: 'https://finance.test/api/v1/capabilities/invoices_create',
        token: 'usr_ama-token',
        body: {
          title: 'Intervention — Onduleur en défaut — Hôtel Sarakawa',
          partyId: 'pty_0000000000000000000000000000beef',
          partyName: 'Hôtel Sarakawa',
          taxRate: 18,
          lines: [
            { label: '2026-10-12 — Diagnostic onduleur (1.5 h)', quantity: 1, unitPrice: 22_500 },
            { label: '2026-10-13 — Remplacement carte de puissance (1 h)', quantity: 1, unitPrice: 15_000 },
            { label: '2026-10-13 — pièces : Remplacement carte de puissance', quantity: 1, unitPrice: 120_000 },
          ],
        },
      },
    ]);
    const interventions = await transaction(ORG, (tx) => interventionsOf(tx, ids.ticket));
    expect(interventions.map((one) => one.invoiceDraftId)).toEqual(['drf_1', 'drf_1']);
  });

  it('never prepares the same interventions twice; a new one makes a new draft', async () => {
    expect(
      await gesture(ama, 'tickets_prepare_invoice', { ticketId: ids.ticket, taxRate: 18 }),
    ).toMatchObject({ ok: false, code: 'nothing_to_invoice' });
    done(
      await gesture(ama, 'interventions_record', {
        ticketId: ids.ticket,
        doneOn: '2026-10-14',
        label: 'Contrôle après réparation',
        minutes: 30,
        hourlyRate: 15_000,
      }),
    );
    expect(
      done(await gesture<{ draftId: string }>(ama, 'tickets_prepare_invoice', { ticketId: ids.ticket, taxRate: 18 }))
        .draftId,
    ).toBe('drf_2');
    expect((finance.asked[1]?.body['lines'] as unknown[]).length).toBe(1);
  });

  it('prepares nothing under warranty, and nothing is marked when Kete Finance refuses', async () => {
    done(await gesture(ama, 'tickets_set_billing', { ticketId: ids.warranty, kind: 'warranty' }));
    done(
      await gesture(ama, 'interventions_record', {
        ticketId: ids.warranty,
        doneOn: '2026-10-13',
        label: 'Remplacement du panneau',
        minutes: 120,
        hourlyRate: 15_000,
        parts: 180_000,
      }),
    );
    expect(
      await gesture(ama, 'tickets_prepare_invoice', { ticketId: ids.warranty, taxRate: 18 }),
    ).toMatchObject({ ok: false, code: 'not_billable' });
    const asked = finance.asked.length;
    done(
      await gesture(ama, 'tickets_set_billing', {
        ticketId: ids.warranty,
        kind: 'billable',
        partyName: 'Clinique Biasa',
      }),
    );
    finance.refuse = true;
    expect(
      await gesture(ama, 'tickets_prepare_invoice', { ticketId: ids.warranty, taxRate: 0 }),
    ).toMatchObject({ ok: false, code: 'finance_refused', facts: { reason: 'not_allowed' } });
    finance.refuse = false;
    expect(finance.asked.length).toBe(asked + 1);
    const interventions = await transaction(ORG, (tx) => interventionsOf(tx, ids.warranty));
    expect(interventions[0]?.invoiceDraftId).toBeNull();
  });

  it('says Kete Finance is not connected when it has no address', async () => {
    delete process.env.FINANCE_URL;
    expect(
      await gesture(ama, 'tickets_prepare_invoice', { ticketId: ids.warranty, taxRate: 0 }),
    ).toMatchObject({ ok: false, code: 'finance_not_connected' });
    process.env.FINANCE_URL = 'https://finance.test';
  });
});
