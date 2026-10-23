import type { KeteIdentity } from '@kete/auth';
import { holdingBody, objectBody } from '@kete/center';
import { validateManifest, validateObject } from '@kete/sdk';
import { performGesture, type Caller } from '@kete/capabilities';
import { executeCommand } from '@kete/commands';
import { createTestSchema, type TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrations } from '../db/migrations';
import { ticketHoldings, ticketObjects, ticketOrganizations } from '../src/features/tickets';
import { manifest } from '../src/platform/events';
import { acknowledgeTicket, suspendTicket } from '../src/features/tickets/commands';
import { insertQueue } from '../src/features/tickets/infrastructure/ticket.table';
import { transaction, usePool } from '../src/platform/db';
import { registry } from '../src/platform/registry';
import { asPerson } from '../src/platform/rights';
import { screenActor } from '../src/platform/session';

// Spec 006 (kete-core spec 114): Support on the living model. A ticket in someone's hands is said
// as a holding — taken, due at its target; suspended, waiting on its requester — and invoicing a
// client passes through the organization's policies first.

const ORG = 'org_model';
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
const caller: Caller = { actor: screenActor(ama), organizationId: ORG };
const gesture = <T = Record<string, unknown>>(name: string, input: unknown) =>
  performGesture<T>(registry, { ...caller, name, input }, (work) =>
    asPerson(ama, work, 'usr_ama-token'),
  );
const done = <T>(outcome: { ok: true; output: T } | { ok: false; code: string }): T => {
  if (!outcome.ok) throw new Error(`refused: ${outcome.code}`);
  return outcome.output;
};

const asked = { finance: 0, gestures: [] as Record<string, unknown>[] };
function fakeServices(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
  if (url === 'https://api.center.test/v1/apps/prd_kete_helpdesk/gestures') {
    asked.gestures.push(body);
    return Promise.resolve(
      Response.json({
        verdict: {
          effect: 'refuse',
          policies: [{ id: 'billing.head', sentence: 'Seul le chef SAV facture une intervention' }],
          approvers: [],
        },
      }),
    );
  }
  if (url.startsWith('https://finance.test/')) asked.finance += 1;
  return Promise.resolve(Response.json({ status: 'draft', draftId: 'drf_1' }, { status: 202 }));
}

let ticketId = '';

beforeAll(async () => {
  process.env.ENTERPRISE_API_URL = 'https://api.center.test';
  process.env.FINANCE_URL = 'https://finance.test';
  process.env.PUBLIC_URL = 'https://support.test';
  vi.stubGlobal('fetch', fakeServices);
  db = await createTestSchema({
    migrate: async (owner, context) => {
      for (const migration of migrations) await owner.query(migration.sql(context));
    },
  });
  usePool(db.app);
  const queue = await transaction(ORG, (tx) =>
    insertQueue(tx, ORG, { name: 'Maintenance', indicators: [] }),
  );
  ticketId = done(
    await gesture<{ ticketId: string }>('tickets_open', {
      queueId: queue.queueId,
      title: 'Onduleur en défaut — Hôtel Sarakawa',
      criticality: 'standard',
    }),
  ).ticketId;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  for (const name of ['ENTERPRISE_API_URL', 'FINANCE_URL', 'PUBLIC_URL']) delete process.env[name];
  await db.drop();
});

describe('what Support holds', () => {
  it('says nothing of a ticket nobody took, then its assignee’s once taken', async () => {
    expect(await transaction(ORG, (tx) => ticketHoldings(tx, 'https://support.test'))).toEqual([]);
    await transaction(ORG, (tx) =>
      executeCommand(tx, acknowledgeTicket, {
        ...caller,
        idempotencyKey: 'model-ack-1',
        input: { ticketId },
      }),
    );
    const [taken] = await transaction(ORG, (tx) => ticketHoldings(tx, 'https://support.test'));
    expect(taken).toMatchObject({
      kind: 'ticket',
      ref: ticketId,
      holder: { kind: 'person', id: 'usr_ama' },
      state: 'held',
      href: `https://support.test/tickets/${ticketId}`,
    });
    expect(taken?.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // In the contract's shape (holding.v1), under Support's product.
    expect(holdingBody('prd_kete_helpdesk', taken as never)).toMatchObject({
      source: { app: 'prd_kete_helpdesk', kind: 'ticket', ref: ticketId },
      holder: { kind: 'person', id: 'usr_ama' },
      state: 'held',
    });
    expect(await ticketOrganizations(db.app)).toContain(ORG);
  });

  it('waits on nobody else when its requester is who holds it, even suspended', async () => {
    await transaction(ORG, (tx) =>
      executeCommand(tx, suspendTicket, {
        ...caller,
        idempotencyKey: 'model-suspend-1',
        input: { ticketId, reason: 'En attente de la pièce' },
      }),
    );
    const [suspended] = await transaction(ORG, (tx) => ticketHoldings(tx, null));
    expect(suspended).toMatchObject({ state: 'held' });
    expect(suspended).not.toHaveProperty('href');
  });
});

describe('Support’s tickets in the center’s index (spec 009)', () => {
  it('declares its kind « ticket » and says each ticket in the contract’s shape', async () => {
    const declared = manifest();
    expect(validateManifest(declared).ok).toBe(true);
    expect(declared.objects?.[0]).toMatchObject({ kind: 'ticket', axes: ['person'] });
    const [ticket] = await transaction(ORG, (tx) => ticketObjects(tx, 'https://support.test'));
    expect(ticket).toMatchObject({
      kind: 'ticket',
      id: ticketId,
      personId: 'usr_ama',
      href: `https://support.test/tickets/${ticketId}`,
    });
    expect(declared.objects?.[0]?.states.some((s) => s.id === ticket?.state)).toBe(true);
    expect(validateObject(objectBody(ticket as never)).ok).toBe(true);
  });
});

describe('invoicing a client through the organization’s policies', () => {
  it('is refused with their sentence, and Kete Finance is never asked', async () => {
    done(
      await gesture('tickets_set_billing', {
        ticketId,
        kind: 'billable',
        partyId: 'pty_0000000000000000000000000000beef',
        partyName: 'Hôtel Sarakawa',
      }),
    );
    done(
      await gesture('interventions_record', {
        ticketId,
        doneOn: '2026-10-12',
        label: 'Diagnostic onduleur',
        minutes: 60,
        hourlyRate: 15_000,
        parts: 0,
      }),
    );
    expect(await gesture('tickets_prepare_invoice', { ticketId, taxRate: 18 })).toMatchObject({
      ok: false,
      code: 'refused_by_policy',
      facts: { reason: 'Seul le chef SAV facture une intervention' },
    });
    expect(asked.gestures.at(-1)).toMatchObject({
      kind: 'invoice.issue',
      object: { kind: 'party', id: 'pty_0000000000000000000000000000beef' },
      amount: { value: 15_000, currency: 'XOF' },
    });
    expect(asked.finance).toBe(0);
  });
});
