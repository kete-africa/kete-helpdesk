import { createTokenVerifier, type KeteIdentity } from '@kete/auth';
import { createMcpHandler, protectedResourceMetadata } from '@kete/capabilities';
import { keteViews } from '@kete/views';
import { APP_SLUG, DESIGN, VERSION } from './app';
import { env } from './env';
import { registry } from './registry';
import { asPerson, currentIdentity } from './rights';

let verify: ((token: string) => Promise<KeteIdentity>) | undefined;

/** A Compte Kete access token, from an MCP client the person signed in with (Claude, ChatGPT…). */
async function identityOf(request: Request): Promise<KeteIdentity | null> {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return null;
  verify ??= createTokenVerifier({ issuer: env.accountUrl });
  try {
    return await verify(header.slice('Bearer '.length));
  } catch {
    return null;
  }
}

let handler: ((request: Request) => Promise<Response>) | undefined;

function mcp(): (request: Request) => Promise<Response> {
  handler ??= createMcpHandler({
    registry,
    server: { name: APP_SLUG, version: VERSION },
    // The client acts for the person who signed in: an agent, never more than her.
    async caller() {
      const identity = currentIdentity();
      if (!identity?.organizationId) return null;
      return {
        actor: {
          kind: 'agent',
          id: 'agt_mcp',
          channel: 'mcp',
          onBehalfOf: { kind: 'person', id: identity.userId },
        },
        organizationId: identity.organizationId,
      };
    },
    views: keteViews({ design: DESIGN === 'workspace' ? 'workspace' : 'kete' }),
    draftUrl: (id) => `${env.publicUrl}/verification/${id}`,
    resourceMetadataUrl: `${env.publicUrl}/.well-known/oauth-protected-resource`,
  });
  return handler;
}

/** The app's MCP endpoint: its capabilities and their views (doctrine D-037). */
export async function handleMcp(request: Request): Promise<Response> {
  const identity = await identityOf(request);
  return asPerson(identity, () => mcp()(request));
}

/** Where MCP clients learn that the Compte Kete issues this endpoint's tokens (RFC 9728). */
export function mcpResourceMetadata(): Response {
  return protectedResourceMetadata({
    resource: `${env.publicUrl}/mcp`,
    authorizationServers: [env.accountUrl],
  })();
}
