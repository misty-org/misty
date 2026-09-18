// SDK-owned disposable integration server. Uses a frozen build of the native API
// and real local PostgreSQL + Journal Worker. Never reads application .env.
import { readFile, writeFile, stat, rm } from "node:fs/promises";
import { randomUUID, generateKeyPairSync, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const inputPath = process.argv[2];
if (!inputPath || (await stat(inputPath)).mode & 0o077) throw new Error("Provide a mode0600 fixture configuration file");
const config = JSON.parse(await readFile(inputPath, "utf8"));
if (await stat(config.outputPath).then(() => true, (error) => error.code === "ENOENT" ? false : Promise.reject(error)))
  throw new Error("A fixture output already exists; close its owner first");
const snapshot = config.snapshot;
if (typeof snapshot !== "string" || !snapshot.startsWith("/tmp/misty-sdk-journal-server-")) throw new Error("Use an SDK-owned compiled server snapshot");
const requireServer = createRequire(join(snapshot, "package.json"));
const { Pool } = requireServer("pg");
const { pino } = requireServer("pino");
const { serve } = requireServer("@hono/node-server");
const load = (path) => import(pathToFileURL(join(snapshot, "dist", path)).href);
const { createApi } = await load("apps/api/src/app.js");
const { createAuthService, hashToken } = await load("apps/api/src/modules/auth/service.js");
const { createAuthRepository } = await load("apps/api/src/modules/auth/repository.js");
const { createPasswordHasher } = await load("apps/api/src/modules/auth/passwords.js");
const { createAppRuntimeRepository } = await load("apps/api/src/modules/app-runtime/repository.js");
const { createInstallationRepository } = await load("apps/api/src/modules/official-apps/repository.js");
const { createOfficialCatalog } = await load("apps/api/src/modules/official-apps/catalog.js");
const { createJournalNotes } = await load("apps/api/src/modules/journal/notes.js");
const { createJournalDrawings } = await load("apps/api/src/modules/journal/drawings.js");
const { createAssetRepository } = await load("apps/api/src/modules/journal/asset-repository.js");
const { createJournalAssets } = await load("apps/api/src/modules/journal/assets.js");
const { createS3Store } = await load("apps/api/src/modules/storage/s3-store.js");
const { createStorageJobs } = await load("apps/api/src/modules/storage/jobs.js");
const { withTransaction } = await load("packages/database/src/transaction.js");
const { createRequestBoundary } = await load("packages/runtime/src/request-boundary.js");
const { createCollaborationTickets } = await load("apps/api/src/modules/collaboration/tickets.js");
const { createControlSender } = await load("apps/api/src/modules/collaboration/control.js");
const { createControlJobs } = await load("apps/api/src/modules/collaboration/control-jobs.js");
const { createNoteProjectionRepository } = await load("apps/api/src/modules/collaboration/projections.js");
const { createSpaceRepository } = await load("apps/api/src/modules/spaces/repository.js");
const { applyMigrations, readMigrations } = await load("packages/database/src/migrations.js");
const dbUrl = new URL(config.databaseUrl), endpoint = new URL(config.s3.endpoint);
if (dbUrl.pathname !== "/misty_hono_journal_fixture_test" || !["127.0.0.1", "localhost"].includes(dbUrl.hostname) ||
  !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) || endpoint.protocol !== "https:") throw new Error("Fixture requires dedicated local database and HTTPS object endpoint");
const admin = new Pool({ connectionString: config.databaseUrl, max: 2 });
await applyMigrations(admin, await readMigrations(join(snapshot, "migrations")));
const application = new Pool({ connectionString: config.databaseUrl, options: "-c role=misty_hono_app_test", max: 8 });
await admin.query(`GRANT USAGE ON SCHEMA public TO misty_hono_app_test;
  GRANT SELECT,INSERT,UPDATE,DELETE ON users,licenses,sessions,user_app_installations,app_runtime_sessions,app_data_deletion_jobs,app_install_events,
    space_notes,space_note_links,space_note_assets,space_note_control_outbox,space_drawings,space_drawing_assets,space_drawing_control_outbox,space_events,
    space_library_uploads,space_upload_reservations,space_storage_usage,owner_storage_usage,space_storage_contributions,library_files,library_blobs,
    space_library_audit_events,object_deletion_jobs TO misty_hono_app_test;
  GRANT SELECT,UPDATE ON spaces,space_members,space_conversation_members TO misty_hono_app_test;
  GRANT SELECT ON library_legal_holds,space_conversations,space_rendition_reservations,
    personal_agents,personal_agent_versions,space_runs,space_tasks,space_messages TO misty_hono_app_test;
  GRANT USAGE,SELECT ON app_install_events_id_seq,space_events_id_seq,space_library_audit_events_id_seq TO misty_hono_app_test;`);
const keys = generateKeyPairSync("ed25519");
const collaborationConfig = {
  origin: "http://localhost", privateKey: keys.privateKey, roomSalt: randomBytes(32),
  controlSecret: randomBytes(32), projectionSecret: randomBytes(32), previousProjectionSecret: null,
  issuer: "misty-api", audience: "misty-journal-collab",
};
const workerRequire = createRequire(config.workerPackage);
const { Miniflare, Response: WorkerResponse } = workerRequire("miniflare");
let apiBase;
let projections = 0;
const runtime = new Miniflare({
  modulesRoot: snapshot, modules: true, scriptPath: join(snapshot, "worker.js"),
  compatibilityDate: "2026-06-25", compatibilityFlags: ["nodejs_compat"],
  durableObjects: { NOTE_ROOM: { className: "NoteRoom", useSQLite: true }, DRAWING_ROOM: { className: "DrawingRoom", useSQLite: true } },
  bindings: {
    JOURNAL_COLLAB_TICKET_PUBLIC_KEY: keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64"),
    JOURNAL_COLLAB_CONTROL_SECRET: collaborationConfig.controlSecret.toString("base64"),
    JOURNAL_COLLAB_PROJECTION_SECRET: collaborationConfig.projectionSecret.toString("base64"),
    JOURNAL_COLLAB_ISSUER: collaborationConfig.issuer, JOURNAL_COLLAB_AUDIENCE: collaborationConfig.audience,
    MISTY_INTERNAL_API_BASE: "https://sdk-fixture.invalid",
  },
  // Route only the signed projection callback to the actual local native API.
  // The response is never stubbed: HTTP validation and PostgreSQL writes run.
  outboundService: async (request) => {
    if (!apiBase || request.url !== "https://sdk-fixture.invalid/internal/journal/note-projections" || request.method !== "POST")
      return new WorkerResponse("Not found", { status: 404 });
    const response = await fetch(`${apiBase}/internal/journal/note-projections`, {
      method: "POST", headers: request.headers, body: await request.arrayBuffer(), redirect: "error",
    });
    const body = await response.text();
    if (response.ok && JSON.parse(body).applied === true) projections++;
    return new WorkerResponse(body, { status: response.status, headers: { "Content-Type": "application/json" } });
  },
});
collaborationConfig.origin = (await runtime.ready).origin;
const controls = createControlJobs(application, createControlSender(collaborationConfig, "hosted"));
const store = createS3Store(config.s3), jobs = createStorageJobs(application, store);
const auth = createAuthService({ repository: createAuthRepository(application), passwords: await createPasswordHasher(), deployment: "hosted" });
const username = `fixture_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const account = await auth.register({ username, email: `${username}@example.invalid`, name: "Disposable Journal fixture", password: randomUUID(), analyticsEnabled: false });
const spaceId = randomUUID(), domainId = randomUUID();
let server, closing = false;
async function close() {
  if (closing) return; closing = true;
  if (server) { server.close(); server.closeAllConnections(); await once(server, "close"); }
  await runtime.dispose();
  await withTransaction(admin, async (client) => {
    await client.query("DELETE FROM object_deletion_jobs WHERE object_key IN (SELECT object_key FROM space_library_uploads WHERE user_id=$1)", [account.user.id]);
    await client.query("DELETE FROM spaces WHERE id=$1", [spaceId]);
    await client.query("DELETE FROM library_files WHERE security_domain_id=$1", [domainId]);
    await client.query("DELETE FROM library_blobs WHERE security_domain_id=$1", [domainId]);
    await client.query("DELETE FROM security_domains WHERE id=$1", [domainId]);
    await client.query("DELETE FROM users WHERE id=$1", [account.user.id]);
  });
  store.close(); await application.end(); await admin.end(); await rm(config.outputPath, { force: true });
}
try {
  await withTransaction(admin, async (client) => {
    await client.query("INSERT INTO security_domains(id,kind,owner_user_id,space_id) VALUES($1,'space',$2,$3)", [domainId, account.user.id, spaceId]);
    await client.query("INSERT INTO spaces(id,owner_user_id,name,security_domain_id) VALUES($1,$2,'Journal fixture',$3)", [spaceId, account.user.id, domainId]);
    await client.query("INSERT INTO space_members(space_id,user_id,role) VALUES($1,$2,'owner')", [spaceId, account.user.id]);
  });
  const installations = createInstallationRepository(application);
  const catalog = createOfficialCatalog(JSON.parse(await readFile(config.catalog, "utf8")));
  if (!config.host) await installations.install(account.user.id, catalog.find("journal"));
  const appToken = randomUUID(), secondToken = randomUUID(), controlToken = randomUUID();
  if (!config.host) {
    await installations.session(account.user.id, "journal", hashToken(appToken), spaceId);
    await installations.session(account.user.id, "journal", hashToken(secondToken), spaceId);
  }
  const tickets = createCollaborationTickets(collaborationConfig);
  const notes = createJournalNotes(application, tickets), drawings = createJournalDrawings(application, tickets);
  const note = await notes.create({ userId: account.user.id }, spaceId, "Fixture note");
  const drawing = await drawings.create({ userId: account.user.id }, spaceId, "Fixture drawing");
  const appRuntime = createAppRuntimeRepository(application);
  const app = createApi({ logger: pino({ level: "silent" }), checkDatabase: async () => {}, isDraining: () => closing, migrationComplete: false,
    auth: { service: auth, boundary: createRequestBoundary({ peerAddress: () => "127.0.0.1" }), deployment: "hosted" },
    officialApps: { auth, catalog, repository: installations },
    spaces: { auth, appRuntime, repository: createSpaceRepository(application) },
    noteProjections: { config: collaborationConfig, apply: createNoteProjectionRepository(application) },
    journal: { auth, appRuntime, notes, drawings, assets: createJournalAssets(createAssetRepository(application), store) }, appRuntime: { repository: appRuntime } });
  app.post("/_fixture/:action", async (c) => {
    if (c.req.header("X-Fixture-Control") !== controlToken) return c.json({ code: "not_found" }, 404);
    if (c.req.param("action") === "state") {
      return c.json({ projections, note: await notes.get({ userId: account.user.id }, spaceId, note.id) });
    } else if (c.req.param("action") === "shutdown") {
      setTimeout(() => { void close().then(() => process.exit(0), () => process.exit(1)); }, 100);
      return c.json({ ok: true });
    } else if (c.req.param("action") === "controls") {
      return c.json({ work: await controls.runOnce() });
    } else if (c.req.param("action") === "revoke") {
      await admin.query("DELETE FROM app_runtime_sessions WHERE token_hash=$1", [hashToken(appToken)]);
    } else if (c.req.param("action") === "expire-and-cleanup") {
      await admin.query("UPDATE space_library_uploads SET expires_at=now()-interval '2 minutes' WHERE user_id=$1 AND state<>'ready'", [account.user.id]);
      await admin.query("UPDATE object_deletion_jobs SET not_before=now()-interval '1 second' WHERE object_key IN (SELECT object_key FROM space_library_uploads WHERE user_id=$1)", [account.user.id]);
      await jobs.runOnce();
    } else return c.json({ code: "not_found" }, 404);
    return c.json({ ok: true });
  });
  server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  if (!server.listening) await once(server, "listening");
  const address = server.address();
  apiBase = `http://127.0.0.1:${address.port}`;
  await writeFile(config.outputPath, JSON.stringify({ apiBase: `http://127.0.0.1:${address.port}/v1`, appToken, secondToken,
    ...(config.host ? { accountToken: account.token } : {}), userId: account.user.id, controlToken,
    controlBase: `http://127.0.0.1:${address.port}/_fixture`, spaceId, noteId: note.id, drawingId: drawing.id, pid: process.pid }, null, 2), { mode: 0o600, flag: "wx" });
  console.log("Disposable Journal fixture ready; credentials written to its private output file.");
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { void close().catch(() => { process.exitCode = 1; }); });
} catch (error) { await close(); throw error; }
