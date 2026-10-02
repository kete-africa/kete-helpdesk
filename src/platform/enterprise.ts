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
