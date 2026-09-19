import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MistyCapabilityOutcomeSchema } from "@misty/contracts";
import { openHabitAdapter } from "./adapter.ts";
import { appID, connectionID, manifest } from "./manifest.ts";
import { createHabitClient } from "./client.ts";

function envelope(capability, input, targetID = "30000000-0000-4000-8000-000000000001") {
  return { protocol: 1, execution: { requestId: randomUUID(), runId: randomUUID(), effectId: randomUUID(), grantIds: [], capability, capabilityVersion: 1, providerId: manifest.providers[0].id, providerVersion: 1, targetId: targetID, targetRevision: 1, input, deadline: new Date(Date.now()+60_000).toISOString() }, target: { id: targetID, revision: 1, appId: appID, providerId: manifest.providers[0].id, providerVersion: 1, label: "My habits", binding: { kind: "backend", connectionId: connectionID } } };
}
function execute(adapter, request) { return adapter.execute(request, request.execution.effectId); }

test("a committed habit survives a lost reply and process restart without duplication", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "misty-habit-proof-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, "habits.sqlite");
  let adapter = openHabitAdapter(filename);
  const request = envelope("habits.record", { name: "Walk", day: "2026-09-07", note: "Around the park" });
  const original = execute(adapter, request);
  assert.equal(original.status, "success");
  assert.equal(MistyCapabilityOutcomeSchema.safeParse(original).success, true);
  adapter.close(); adapter = openHabitAdapter(filename); t.after(() => adapter.close());
  assert.deepEqual(execute(adapter, request), original);
  const shortened = structuredClone(request); shortened.execution.deadline = "2020-01-01T00:00:00Z";
  assert.deepEqual(execute(adapter, shortened), original, "a changed transport deadline must replay the confirmed effect after restart");
  const changed = structuredClone(request); changed.execution.input.name = "Another habit";
  assert.equal(execute(adapter, changed).code, "effect_conflict");
  const swapped = structuredClone(request); swapped.execution.targetId = swapped.target.id = randomUUID();
  assert.equal(execute(adapter, swapped).code, "effect_conflict");
  const result = execute(adapter, envelope("habits.list", {}));
  assert.deepEqual(result.result.entries, [original.result]); assert.equal(result.partial, false);
});

test("list pagination is explicit and writes validate before committing", (t) => {
  const adapter = openHabitAdapter(":memory:"); t.after(() => adapter.close());
  for (const name of ["Walk", "Read", "Stretch"]) assert.equal(execute(adapter, envelope("habits.record", { name, day: "2026-09-07" })).status, "success");
  for (const input of [{ name: "", day: "2026-09-07" }, { name: "Walk", day: "2026-02-30" }, { name: "Walk", day: "2026-09-07", approved: true }]) assert.equal(execute(adapter, envelope("habits.record", input)).code, "invalid_input");
  const first = execute(adapter, envelope("habits.list", { limit: 2 }));
  assert.equal(first.partial, true); assert.equal(first.result.entries.length, 2);
  const second = execute(adapter, envelope("habits.list", { cursor: first.result.nextCursor, limit: 2 }));
  assert.equal(second.partial, false); assert.equal(second.result.nextCursor, null); assert.equal(second.result.entries.length, 1);
});

test("invalid host identity and expired new effects never mutate", (t) => {
  const adapter = openHabitAdapter(":memory:"); t.after(() => adapter.close());
  const request = envelope("habits.record", { name: "Walk", day: "2026-09-07" });
  assert.equal(adapter.execute(request, randomUUID()).code, "target_mismatch");
  const wrong = structuredClone(request); wrong.target.binding.connectionId = randomUUID();
  assert.equal(execute(adapter, wrong).code, "target_mismatch");
  request.execution.deadline = "2020-01-01T00:00:00Z";
  assert.equal(execute(adapter, request).code, "deadline_expired");
  assert.equal(execute(adapter, envelope("habits.list", {})).result.entries.length, 0);
});

test("the sample registers through public app-scoped SDK RPC", async () => {
  const sent = [];
  const client = createHabitClient({ apiURL: "https://misty.example/v1", appToken: "installation-token", fetch: async (url, options) => {
    sent.push({ url, options, body: JSON.parse(options.body) });
    return Response.json({ provider: manifest.providers[0], availability: { state: "available", observedAt: new Date().toISOString() } });
  } });
  await client.register("a".repeat(64));
  assert.equal(sent[0].body.method, "capabilities.providers.register");
  assert.equal(sent[0].options.headers.Authorization, "Bearer installation-token");
  assert.equal(sent[0].options.redirect, "error");
  assert.equal(sent[0].body.params.body.provider.id, "example.habits/backend");
});

test("the sample signs the exact public install document with a persistent publisher", async (t) => {
  const { execFileSync } = await import("node:child_process");
  const { readFileSync, statSync } = await import("node:fs");
  const { createHash, createPublicKey, verify } = await import("node:crypto");
  const { fileURLToPath } = await import("node:url");
  const directory = mkdtempSync(join(tmpdir(), "misty-habit-signature-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const signScript = fileURLToPath(new URL("sign-manifest.ts", import.meta.url));
  execFileSync(process.execPath, [signScript, directory]);
  const signed = JSON.parse(readFileSync(join(directory, "installation.json")));
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(signed.manifest.publicKey, "base64")]), type: "spki", format: "der" });
  assert.equal(verify(null, Buffer.from(`misty.sdk.manifest.v1\n${signed.manifest.document}`), publicKey, Buffer.from(signed.manifest.signature, "base64")), true);
  assert.equal(signed.reviewedDigest, createHash("sha256").update(signed.manifest.document).digest("hex"));
  assert.equal(JSON.parse(signed.manifest.document).appId, appID);
  assert.equal(statSync(join(directory, "publisher.pem")).mode & 0o777, 0o600);
  execFileSync(process.execPath, [signScript, directory]);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, "installation.json"))), signed);
});

test("the standalone HTTP adapter authenticates before accepting an effect", async (t) => {
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const { fileURLToPath } = await import("node:url");
  const directory = mkdtempSync(join(tmpdir(), "misty-habit-http-"));
  const token = "test-only-habit-token-" + randomUUID();
  const child = spawn(process.execPath, [fileURLToPath(new URL("server.ts", import.meta.url))], { cwd: directory, env: { PORT: "0", HABITS_BACKEND_TOKEN: token, HABITS_DATABASE: join(directory, "habits.sqlite") }, stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; }
    rmSync(directory, { recursive: true, force: true });
  });
  const [chunk] = await once(child.stdout, "data", { signal: AbortSignal.timeout(5000) });
  const { port } = JSON.parse(chunk.toString());
  assert.ok(port > 0);
  const request = envelope("habits.record", { name: "Walk", day: "2026-09-07" });
  const post = (authorization, body = request) => fetch(`http://127.0.0.1:${port}/execute`, { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json", "Idempotency-Key": request.execution.effectId }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  assert.equal((await post("Bearer incorrect")).status, 401);
  const committed = await post(`Bearer ${token}`);
  assert.equal(committed.status, 200);
  const outcome = await committed.json(); assert.equal(outcome.status, "success");
  assert.deepEqual(await (await post(`Bearer ${token}`)).json(), outcome);
});
