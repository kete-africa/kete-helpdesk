import {
  createOutboxRelay,
  httpTransport,
  outboxBacklog,
  parseManifest,
  type HealthOptions,
  type Manifest,
} from '@kete/sdk';
import app from '../../kete.json' with { type: 'json' };
import { PRODUCT, VERSION } from './app';
import { getPool } from './db';

/** The events this app announces to Kete Cockpit; its manifest declares exactly these. */
export const DECLARED_EVENTS: string[] = [...app.events];

function environment(): Manifest['environment'] {
  const value = process.env.KETE_ENVIRONMENT;
  return value === 'production' || value === 'staging' || value === 'preview'
    ? value
    : 'development';
}

/** The app's self-description, served at /.well-known/kete. */
export function manifest(): Manifest {
  return parseManifest({
    product: PRODUCT,
    name: app.name,
    version: VERSION,
    environment: environment(),
    events: DECLARED_EVENTS,
    // Who answers for the app, its data, its use of AI, its criticality (doctrine D-040).
    governance: app.governance,
  });
}

export const health: HealthOptions = {
  version: VERSION,
  dependencies: [{ name: 'database', probe: () => getPool().query('select 1') }],
  // Events waiting to be delivered to Kete Cockpit.
  backlog: () => outboxBacklog(getPool()),
};

/** Delivers the outbox to Kete Cockpit once, when its key is configured (the worker's job). */
export async function flushEvents(): Promise<void> {
  const url = process.env.KETE_EVENTS_URL;
  const kid = process.env.KETE_EVENTS_KID;
  const secret = process.env.KETE_EVENTS_SECRET;
  if (!url || !kid || !secret) return;
  await createOutboxRelay({
    pool: getPool(),
    transport: httpTransport({ url }),
    product: PRODUCT,
    key: { kid, secret },
  }).flush();
}
