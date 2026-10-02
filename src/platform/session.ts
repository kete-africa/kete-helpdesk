import { createKeteSignIn, type KeteIdentity, type KeteSignIn } from '@kete/auth';
import type { Actor } from '@kete/commands';
import { env } from './env';

let signIn: KeteSignIn | undefined;

/** People sign in with their Compte Kete; this app keeps no password. */
export function getSignIn(): KeteSignIn {
  signIn ??= createKeteSignIn({
    accountUrl: env.accountUrl,
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    redirectUri: `${env.publicUrl}/auth/callback`,
    sessionSecret: env.sessionSecret,
    // The person's token stays on the server: the app sends readings to Kete Enterprise for her.
    keepAccessToken: true,
  });
  return signIn;
}

export function personOf(request: Request): Promise<KeteIdentity | null> {
  return getSignIn().session(request);
}

/** The person, acting on a screen of this app. */
export function screenActor(identity: KeteIdentity): Actor {
  return { kind: 'person', id: identity.userId, channel: 'web' };
}
