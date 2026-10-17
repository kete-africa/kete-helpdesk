import { themeFromCookies } from '@kete/design';
import {
  createAccountSettings,
  defineSettings,
  keteSettings,
  resolve,
  settingsHere,
  type Resolved,
} from '@kete/settings';
import type { SqlExecutor } from '@kete/tenancy';
import { tokenOf } from './session';

// Support's settings (kete-core specs 115 and 117; decision 0013): Kete's own, declared once,
// resolved by layers — the organization's in the Compte Kete, the app's kept here
// (`kete_settings`), the person's, the device's cookie — the most precise wins. No business
// setting is read from an environment variable: the currency of what is billed is `kete.currency`.

export const settingsRegistry = defineSettings(keteSettings);

let account: ReturnType<typeof createAccountSettings> | undefined;
/** The Compte Kete's two layers, read with the person's token. */
export function accountSettings() {
  account ??= createAccountSettings({ url: process.env.KETE_ACCOUNT_URL });
  return account;
}

/**
 * The settings as they apply to the person behind a request: her preferences over the
 * organization's. Reading them keeps the organization's layer for its commands (`settingsIn`).
 */
export async function settingsOf(request: Request): Promise<Resolved> {
  const layers = await accountSettings().read(await tokenOf(request));
  const theme = Object.hasOwn(layers.person, 'kete.theme')
    ? null
    : themeFromCookies(request.headers.get('cookie'));
  return resolve(settingsRegistry, {
    organization: layers.organization,
    person: layers.person,
    ...(theme ? { device: { 'kete.theme': theme } } : {}),
  });
}

/**
 * The settings where a command or a job runs, inside its organization's transaction: the app's
 * layer over the organization's as one of its members last read it — never a person's own.
 */
export function settingsIn(db: SqlExecutor, organizationId: string): Promise<Resolved> {
  return settingsHere(db, settingsRegistry, {
    organization: accountSettings().organization(organizationId),
  });
}
