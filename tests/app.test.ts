import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { KeteIdentity } from '@kete/auth';
import type { Caller } from '@kete/capabilities';
import { executeCommand, readJournal, type CommandDefinition } from '@kete/commands';
import { assertOrganizationIsolation, createTestSchema, type TestSchema } from '@kete/testing';
import type { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrations } from '../db/migrations';
import {
  acknowledgeTicket,
  createQueue,
  reopenTicket,
  restoreTicket,
  resumeTicket,
  suspendTicket,
  withdrawTicket,
} from '../src/features/tickets/commands';
import {
  check,
  elapsedMinutes,
  indicatorsOf,
  mayReopen,
  TicketRuleError,
  withinTarget,
} from '../src/features/tickets/domain/clock';
import { findTicket, listTickets } from '../src/features/tickets/infrastructure/ticket.table';
import { transaction, usePool } from '../src/platform/db';
import { validateManifest } from '@kete/sdk';
import { manifest } from '../src/platform/events';
import { datasets, registry } from '../src/platform/registry';
import { asPerson } from '../src/platform/rights';
import { screenActor } from '../src/platform/session';

// The helpdesk's proof: the clock's rules alone, then a ticket's life on every surface under the
// same rights, the organization as the boundary, and what the app says about itself.

let db: TestSchema;

const person = (userId: string, role: KeteIdentity['role'], organizationId = 'org_acme') =>
  ({
    userId,
    email: `${userId}@example.test`,
    name: userId,
    organizationId,
    role,
    apps: {},
    twoFactor: false,
    expiresAt: new Date(Date.now() + 60_000),
  }) satisfies KeteIdentity;

const ama = person('usr_ama', 'owner');
const kofi = person('usr_kofi', 'member');

const onScreen = (identity: KeteIdentity): Caller => ({
  actor: screenActor(identity),
  organizationId: identity.organizationId ?? '',
});
const agentFor = (identity: KeteIdentity): Caller => ({
  actor: {
    kind: 'agent',
    id: 'agt_mcp',
    channel: 'mcp',
    onBehalfOf: { kind: 'person', id: identity.userId },
  },
  organizationId: identity.organizationId ?? '',
});

const hours = (n: number) => n * 3_600_000;
const at = (n: number) => new Date(Date.UTC(2026, 9, 1) + hours(n));

beforeAll(async () => {
  db = await createTestSchema({
    migrate: async (owner, context) => {
      for (const migration of migrations) await owner.query(migration.sql(context));
    },
  });
  usePool(db.app);
});

afterAll(async () => {
  await db.drop();
});

function run<I extends z.ZodType>(command: CommandDefinition<I, unknown>, input: z.input<I>) {
  return transaction('org_acme', (tx) =>
    executeCommand(tx, command, {
      ...onScreen(ama),
      idempotencyKey: `test-${randomUUID()}`,
      input,
    }),
  );
}

describe('the rules of a ticket', () => {
  it('moves only from the step it is at', () => {
    expect(() => check('acknowledge', 'received')).not.toThrow();
    expect(() => check('restore', 'received')).toThrow(TicketRuleError);
    expect(() => check('reopen', 'acknowledged')).toThrow(TicketRuleError);
  });

  it('runs the clock from acknowledgement to restoration, suspensions left out', () => {
    const ticket = { acknowledgedAt: at(0), restoredAt: at(5), suspendedMinutes: 90 };
    expect(elapsedMinutes(ticket)).toBe(210);
    expect(withinTarget({ ...ticket, criticality: 'critical' })).toBe(true);
    expect(withinTarget({ ...ticket, suspendedMinutes: 0, criticality: 'critical' })).toBe(false);
    expect(elapsedMinutes({ ...ticket, restoredAt: null })).toBeNull();
  });

  it('reopens within seven days only', () => {
    expect(mayReopen(at(0), at(24 * 7))).toBe(true);
    expect(mayReopen(at(0), at(24 * 7 + 1))).toBe(false);
    expect(mayReopen(null, at(0))).toBe(false);
  });

  it('counts a queue’s indicators on its restored tickets', () => {
    const base = { acknowledgedAt: at(0), suspendedMinutes: 0, reopenCount: 0 };
    expect(
      indicatorsOf([
        { ...base, criticality: 'major', restoredAt: at(4) },
        { ...base, criticality: 'major', restoredAt: at(12), reopenCount: 1 },
        { ...base, criticality: 'minor', restoredAt: null },
      ]),
    ).toEqual({ restored: 2, withinTarget: 1, rate: 50, reopened: 1, reopenRate: 50 });
    expect(indicatorsOf([]).rate).toBeNull();
  });
});

describe('a ticket’s life', () => {
  let queueId = '';
  let ticketId = '';

  it('an agent opens a ticket for a member, in her name', async () => {
    const queue = await run(createQueue, {
      name: 'SAV',
      indicators: ['Respect du délai d’intervention contractuel (SLA)'],
    });
    queueId = (queue.output as { queueId: string }).queueId;
    const opened = await asPerson(kofi, () =>
      registry.invoke({
        ...agentFor(kofi),
        name: 'tickets_open',
        input: { queueId, title: 'Onduleur en défaut', criticality: 'critical' },
      }),
    );
    expect(opened).toMatchObject({ status: 'done' });
    const [ticket] = await transaction('org_acme', (tx) => listTickets(tx, { open: true }));
    expect(ticket).toMatchObject({ status: 'received', queueName: 'SAV', requesterName: 'usr_kofi' });
    ticketId = ticket?.ticketId ?? '';
    const journal = await transaction('org_acme', (tx) => readJournal(tx));
    expect(journal.find((e) => e.name === 'open-ticket')).toMatchObject({
      actor: { kind: 'agent' },
      channel: 'mcp',
    });
  });

  it('is acknowledged, suspended with a reason only, resumed and restored', async () => {
    await run(acknowledgeTicket, { ticketId, actorName: 'Ama' });
    await expect(run(suspendTicket, { ticketId })).rejects.toThrow(TicketRuleError);
    await run(suspendTicket, { ticketId, reason: 'Pièce attendue du fournisseur' });
    await run(resumeTicket, { ticketId });
    await run(restoreTicket, { ticketId });
    const ticket = await transaction('org_acme', (tx) => findTicket(tx, ticketId));
    expect(ticket).toMatchObject({ status: 'restored', assigneeName: 'Ama' });
    expect(withinTarget(ticket!)).toBe(true);
    expect(await transaction('org_acme', (tx) => listTickets(tx, { open: true }))).toHaveLength(0);
  });

  it('may be reopened, and counts it', async () => {
    await expect(run(restoreTicket, { ticketId })).rejects.toThrow(TicketRuleError);
    await run(reopenTicket, { ticketId });
    const ticket = await transaction('org_acme', (tx) => findTicket(tx, ticketId));
    expect(ticket).toMatchObject({ status: 'acknowledged', reopenCount: 1, restoredAt: null });
  });

  it('a ticket opened by mistake is withdrawn before anyone takes it, never after', async () => {
    const opened = await asPerson(ama, () =>
      registry.invoke({
        ...onScreen(ama),
        name: 'tickets_open',
        input: { queueId, title: 'Doublon', criticality: 'minor' },
      }),
    );
    expect(opened).toMatchObject({ status: 'done', undo: 'withdraw-ticket' });
    const mistake = (await transaction('org_acme', (tx) => listTickets(tx, { open: true }))).find(
      (t) => t.title === 'Doublon',
    );
    await run(withdrawTicket, { ticketId: mistake?.ticketId ?? '' });
    await expect(run(withdrawTicket, { ticketId })).rejects.toThrow(TicketRuleError);
    expect(await transaction('org_acme', (tx) => findTicket(tx, mistake?.ticketId ?? ''))).toMatchObject({
      status: 'withdrawn',
    });
  });

  it('an agent lists the open tickets as a table its copilot shows', async () => {
    const listed = await asPerson(kofi, () =>
      registry.invoke({ ...agentFor(kofi), name: 'ticket_list', input: {} }),
    );
    expect(listed).toMatchObject({ status: 'done', output: { view: 'table' } });
    expect(queueId).toMatch(/^que_/);
  });
});

describe('rights', () => {
  it('nobody signed in may do anything', async () => {
    expect(
      await asPerson(null, () =>
        registry.invoke({ ...onScreen(ama), name: 'ticket_list', input: {} }),
      ),
    ).toEqual({ status: 'refused', reason: 'not_allowed' });
  });
});

describe('the organization is the boundary', () => {
  it('keeps each organization’s tickets to itself (RLS)', async () => {
    await assertOrganizationIsolation({
      app: db.app,
      table: 'queues',
      organizations: ['org_x', 'org_y'],
      insert: async (client, organizationId) => {
        await client.query(
          `insert into queues (queue_id, organization_id, name) values ($1, $2, 'x')`,
          [`que_${organizationId}`, organizationId],
        );
      },
    });
  });
});

describe('the app contract (kete-core specs 045 and 049)', () => {
  it('declares its tools, its data set and its permissions with their words', () => {
    const card = manifest();
    expect(validateManifest(card).ok).toBe(true);
    expect(card.capabilities?.map((c) => c.name)).toEqual(
      expect.arrayContaining(['ticket_list', 'ticket_get', 'tickets_open']),
    );
    expect(card.datasets?.map((d) => d.name)).toEqual(['tickets']);
    const manage = card.permissions?.find((p) => p.name === 'tickets:manage');
    expect(manage).toMatchObject({ roles: ['owner', 'admin'] });
    expect(manage?.label.fr).toBeTruthy();
  });

  it('reads its tickets as rows a dashboard sums', async () => {
    const read = await asPerson(kofi, () => datasets.read(onScreen(kofi), 'tickets', {}));
    expect(read).toMatchObject({ status: 'done', dataset: 'tickets' });
  });

  it('follows the grants of Kete Enterprise once it manages Support’s rights', async () => {
    process.env.ENTERPRISE_API_URL = 'https://api.center.test';
    vi.stubGlobal('fetch', async () =>
      Response.json({
        managed: true,
        permissions: [{ permission: 'tickets:read', everywhere: false, units: ['unt_sav'] }],
      }),
    );
    try {
      // Kofi may read, not open: opening was not granted to his position.
      const opened = await asPerson(
        kofi,
        () =>
          registry.invoke({
            ...onScreen(kofi),
            name: 'tickets_open',
            input: { queueId: 'que_00000000-aaaa', title: 'Onduleur', criticality: 'major' },
          }),
        'kofi-token',
      );
      expect(opened).toEqual({ status: 'refused', reason: 'not_allowed' });
    } finally {
      vi.unstubAllGlobals();
      delete process.env.ENTERPRISE_API_URL;
    }
  });
});

describe('the business events to Kete Enterprise (kete-core spec 049)', () => {
  it('announces a ticket opened and restored, facts and ids only', async () => {
    expect(manifest().emits?.map((e) => e.type)).toEqual([
      'ticket.opened',
      'ticket.restored',
      'ticket.reopened',
      'ticket.invoice_prepared',
    ]);
    const { rows } = await db.owner.query<{ envelope: { type: string; data: object } }>(
      `select envelope from ${db.schema}.kete_center_outbox order by created_at`,
    );
    expect(rows.map((r) => r.envelope.type)).toContain('ticket.opened');
    expect(rows.map((r) => r.envelope.type)).toContain('ticket.restored');
    expect(rows[0]?.envelope.data).toEqual({
      ticketId: expect.stringMatching(/^tkt_/),
      queueId: expect.stringMatching(/^que_/),
      criticality: expect.any(String),
    });
  });
});

describe('what the app says about itself', () => {
  it('serves a valid manifest, and the same words in every language', () => {
    expect(manifest()).toMatchObject({ product: 'prd_kete_helpdesk', events: [] });
    const fr = JSON.parse(readFileSync(new URL('../messages/fr.json', import.meta.url), 'utf8'));
    const en = JSON.parse(readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8'));
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
  });
});
