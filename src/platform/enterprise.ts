import { getCenter } from './center';
import { tokenOf } from './session';

/**
 * Kete Enterprise, where this app's indicators are read and its tickets reach their holder's To do
 * (its specs 015 and 018): every call carries the person's token — never more than her rights.
 * Without `ENTERPRISE_API_URL`, the app works alone and sends nothing.
 */
export function enterpriseUrl(): string | null {
  return getCenter().connected ? (process.env.ENTERPRISE_API_URL ?? null) : null;
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
  return getCenter().sendReading(await tokenOf(request), reading);
}
