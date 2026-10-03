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

/** Puts a task in the person's one To do; sending it again updates it. */
export async function sendTask(
  request: Request,
  task: { key: string; title: string; href: string; dueAt?: string },
): Promise<void> {
  await getCenter().sendTask(await tokenOf(request), task);
}

/** Takes a task out of the person's To do, once it is done here. */
export async function closeTask(request: Request, key: string): Promise<void> {
  await getCenter().closeTask(await tokenOf(request), key);
}
