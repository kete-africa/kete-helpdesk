import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import { signSession } from '@kete/auth';
import { createTestSchema, loadRepositoryEnv } from '@kete/testing';
import pg from 'pg';
import { migrations } from '../db/migrations';

// `pnpm demo` — Support on this machine, signed in, with an after-sales desk already at work, to
// look at its screens. Nothing here is a deployment: the data live in a throwaway schema of the
// *test* database (`.env`: KETE_TEST_OWNER_URL, KETE_TEST_APP_URL), dropped when the script stops.
// There is no Compte Kete: the script signs a session with a secret made for this run, and a
// local « door » puts it in the browser. No center either, nor Kete Finance: the app works alone.
//
//   http://localhost:3441              enters as the head of after-sales
//   http://localhost:3441/technician   as a technician
//
// `--fresh` reuses the build that is there.

const APP_PORT = 3440;
const DOOR_PORT = 3441;
const root = fileURLToPath(new URL('..', import.meta.url));
const say = (line: string) => console.log(`[demo] ${line}`);

loadRepositoryEnv(root);
for (const name of ['KETE_TEST_APP_URL', 'KETE_TEST_OWNER_URL']) {
  if (!process.env[name]) throw new Error(`${name} must be set (see .env.example).`);
}
// Joined to a Compte Kete on this machine (`KETE_DEMO_JOINED=on`, set by kete-core's
// `pnpm platform`): the app signs people in through it (`KETE_ACCOUNT_URL`, `KETE_CLIENT_ID`,
// `KETE_CLIENT_SECRET`), speaks to the center (`ENTERPRISE_API_URL`), and its data are seeded in
// the Compte Kete's organization, the person signed in being their owner.
const joined = process.env.KETE_DEMO_JOINED === 'on';
const sessionSecret = (joined && process.env.SESSION_SECRET) || randomBytes(32).toString('hex');
Object.assign(process.env, {
  DATABASE_URL: process.env.KETE_TEST_APP_URL,
  OWNER_DATABASE_URL: process.env.KETE_TEST_OWNER_URL,
  // Joined: on 127.0.0.1, the loopback address the Compte Kete accepts for a client's return.
  PUBLIC_URL: `http://${joined ? '127.0.0.1' : 'localhost'}:${APP_PORT}`,
  SESSION_SECRET: sessionSecret,
  ...(joined
    ? {}
    : {
        KETE_ACCOUNT_URL: 'http://localhost:9',
        KETE_CLIENT_ID: 'demo',
        KETE_CLIENT_SECRET: 'demo',
        ENTERPRISE_API_URL: '',
        FINANCE_URL: '',
      }),
});

// A run that was killed could not drop its schema: the next one does.
const leftover = fileURLToPath(new URL('../.demo-schema', import.meta.url));
if (existsSync(leftover)) {
  const name = readFileSync(leftover, 'utf8').trim();
  if (/^t_[0-9a-f]{6,32}$/.test(name)) {
    const owner = new pg.Pool({ connectionString: process.env.KETE_TEST_OWNER_URL, max: 1 });
    await owner.query(`drop schema if exists ${name} cascade`).catch(() => undefined);
    await owner.end();
  }
  rmSync(leftover, { force: true });
}

if (!process.argv.includes('--fresh') || !existsSync(`${root}dist/server/server.js`)) {
  say('Construction des écrans…');
  const built = spawnSync('pnpm build', { cwd: root, shell: true, stdio: 'ignore', env: process.env });
  if (built.status !== 0) throw new Error('The screens did not build: run `pnpm build`.');
}

say('Création d’un schéma jetable dans la base de test…');
const db = await createTestSchema({
  migrate: async (owner, context) => {
    for (const migration of migrations) await owner.query(migration.sql(context));
  },
});
writeFileSync(leftover, db.schema);
const { usePool } = await import('../src/platform/db');
usePool(db.app);
const { demoPeople, seedDemo } = await import('../db/demo/seed');
say(`Schéma ${db.schema}. Données de démonstration…`);
// Seeded as the app alone — its decisions taken here, no center nor other app asked, nobody being
// signed in yet; joined, its screens then speak to them.
const linked = ['ENTERPRISE_API_URL', 'COMMITMENTS_API_URL', 'FINANCE_URL'] as const;
const kept = Object.fromEntries(linked.map((name) => [name, process.env[name]]));
for (const name of linked) delete process.env[name];
await seedDemo();
for (const name of linked) if (kept[name]) process.env[name] = kept[name];

// The screens, served from the build, on the same schema.
const web = spawn(
  `pnpm exec srvx serve --entry dist/server/server.js --static ../client --prod --host 127.0.0.1 --port ${APP_PORT}`,
  {
    cwd: root,
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, PGOPTIONS: `-c search_path=${db.schema}` },
  },
);

// The door: cookies of « localhost » are shared by its ports, so the session set here is the
// app's.
const door = createServer((request, response) => {
  const asked = (request.url ?? '/').replace(/^\//, '').split(/[/?]/)[0] ?? '';
  const who = asked in demoPeople ? demoPeople[asked as keyof typeof demoPeople] : demoPeople.owner;
  void signSession(sessionSecret, who, { seconds: 8 * 3600 }).then((value) => {
    response.writeHead(302, {
      'set-cookie': `kete_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${8 * 3600}`,
      location: `http://localhost:${APP_PORT}/`,
    });
    response.end();
  });
});
door.listen(DOOR_PORT, '127.0.0.1', () => {
  if (joined) say(`Prêt. Connectez-vous par http://127.0.0.1:${APP_PORT} avec votre Compte Kete.`);
  say(`Prêt. Entrez par http://localhost:${DOOR_PORT} (propriétaire).`);
  say(`Autres rôles : ${Object.keys(demoPeople).filter((role) => role !== 'owner').map((role) => `http://localhost:${DOOR_PORT}/${role}`).join(' · ')}`);
});

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  door.close();
  web.kill();
  await db.drop().catch(() => undefined);
  rmSync(leftover, { force: true });
  process.exit(0);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
web.on('exit', () => void stop());
