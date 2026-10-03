import { getSignIn } from './session';

/**
 * Kete Enterprise, where this app's indicators are read (its spec 015): the app sends readings for
 * the person signed in, with her token — never more than her rights. Without `ENTERPRISE_API_URL`,
 * the app works alone and sends nothing.
 */
export function enterpriseUrl(): string | null {
  return (process.env.ENTERPRISE_API_URL ?? '').replace(/\/$/, '') || null;
}

export interface Reading {
  quarter: string;
  indicator: string;
  value: number;
  proof: string;
}

export async function sendReading(
  request: Request,
  reading: Reading,
): Promise<{ ok: boolean; error: string | null }> {
  const base = enterpriseUrl();
  if (!base) return { ok: false, error: 'not_connected' };
  const token = await getSignIn().accessToken(request);
  if (!token) return { ok: false, error: 'signed_out' };
  const response = await fetch(`${base}/v1/performance/readings`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
      'kete-channel': 'api',
    },
    body: JSON.stringify({ ...reading, source: 'kete-helpdesk' }),
  });
  if (response.ok) return { ok: true, error: null };
  const answer = (await response.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: answer.error ?? `http_${response.status}` };
}

/**
 * Puts a task in the person's one To do in Kete Enterprise (its spec 018), with her token: what
 * she took here and must finish, with its deadline. Sending it again updates it. Without
 * `ENTERPRISE_API_URL`, or when Enterprise does not answer, the app goes on alone.
 */
export async function sendTask(
  request: Request,
  task: { key: string; title: string; href: string; dueAt?: string },
): Promise<void> {
  await toEnterprise(request, '/v1/workspace/tasks', { ...task, source: 'kete-helpdesk' });
}

/** Takes a task out of the person's To do in Kete Enterprise, once it is done here. */
export async function closeTask(request: Request, key: string): Promise<void> {
  await toEnterprise(request, '/v1/workspace/tasks/close', { key, source: 'kete-helpdesk' });
}

async function toEnterprise(request: Request, path: string, body: object): Promise<void> {
  const base = enterpriseUrl();
  if (!base) return;
  const token = await getSignIn().accessToken(request);
  if (!token) return;
  await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
      'kete-channel': 'api',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  }).catch(() => undefined);
}
