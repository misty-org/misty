import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createMistyAppSDK, isMistyJournalAssetMethod, mistyJournalAssetServerContracts } from "@misty/sdk";
import { createAppRpcScope, AppRpcError } from "../src/features/apps/rpc/session";
import { createServerRpc } from "../src/features/apps/rpc/server";
import { createJournalAssetsRpc } from "../src/features/apps/rpc/journalAssets";

type Fixture = { apiBase: string; appToken: string; controlToken: string; controlBase: string; spaceId: string; noteId: string; drawingId: string; appId?: string; userId?: string };
type Objects = { endpoint: string; controlToken: string };
const fixture: Fixture = JSON.parse(await readFile(process.argv[2], "utf8"));
const objects: Objects = JSON.parse(await readFile(process.argv[3], "utf8"));
for (const address of [fixture.apiBase, objects.endpoint]) assert.equal(new URL(address).hostname, "127.0.0.1", "This probe only uses disposable loopback fixtures.");
const calls: Array<{ method: string; status: number }> = [];
const appId = fixture.appId ?? "journal";
const scope = createAppRpcScope({ identity: { appId, accountId: fixture.userId ?? "fixture-account", spaceId: fixture.spaceId, instanceId: crypto.randomUUID() },
  scopes: ["notes.read", "notes.write", "drawings.read", "drawings.write"], expiresAt: new Date(Date.now() + 300_000).toISOString(), isCurrentAccount: () => true });
const server = createServerRpc(scope, { serverBase: fixture.apiBase, readAppSession: () => ({ appId, spaceId: fixture.spaceId, token: fixture.appToken }),
  fetch: async (url, init) => { const response = await fetch(url, init); calls.push({ method: JSON.parse(String(init?.body)).method, status: response.status }); return response; } });
const control = async (path: string) => {
  const response = await fetch(new URL(path.replace("/_fixture/", ""), `${fixture.controlBase}/`), { method: "POST", headers: { "X-Fixture-Control": fixture.controlToken }, redirect: "error" });
  assert.equal(response.ok, true, "The disposable server control must succeed.");
};
let revokeAfterPut = false, corruptNextGet = false;
const assets = createJournalAssetsRpc(scope, server, async (url, init) => {
  assert.equal(new URL(String(url)).origin, new URL(objects.endpoint).origin, "Assets must stay in the disposable object fixture.");
  const headers = new Headers(init?.headers);
  assert.equal(headers.has("authorization"), false); assert.equal(headers.has("cookie"), false);
  assert.equal(headers.has("x-misty-library-upload-token"), false);
  assert.equal(init?.credentials, "omit"); assert.equal(init?.redirect, "error");
  const response = await fetch(url, init);
  if (corruptNextGet && (!init?.method || init.method === "GET")) {
    corruptNextGet = false;
    const bytes = new Uint8Array(await response.arrayBuffer()); bytes[0] ^= 1;
    return new Response(bytes, { status: response.status, headers: response.headers });
  }
  if (revokeAfterPut && init?.method === "PUT") { revokeAfterPut = false; await control("/_fixture/revoke"); }
  return response;
});
const sdk = createMistyAppSDK({ request: message => {
  if (message.method === "lifecycle.ready") return Promise.resolve();
  if (isMistyJournalAssetMethod(message.method)) return assets.request(message);
  if (Object.hasOwn(mistyJournalAssetServerContracts, message.method)) return Promise.reject(new AppRpcError("host_owned_transfer", "Use Journal assets through the host."));
  return server.request(message);
} });
try {
  assert.equal((await sdk.notes.get(fixture.noteId)).id, fixture.noteId);
  assert.equal((await sdk.drawings.get(fixture.drawingId)).id, fixture.drawingId);
  // A valid tiny PNG plus trailing bytes exercises more than one SDK transfer chunk.
  const bytes = new Uint8Array(300 * 1024);
  bytes.set(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=", "base64"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const file = new File([bytes], "sdk-network-probe.png", { type: "image/png" });
  const note = await sdk.journal.assets.upload({ resource: "note", resourceId: fixture.noteId, filename: file.name, file });
  const externalFileId = crypto.randomUUID();
  const drawing = await sdk.journal.assets.upload({ resource: "drawing", resourceId: fixture.drawingId, externalFileId, filename: file.name, file });
  assert.equal(note.sha256, sha256); assert.equal(drawing.sha256, sha256);
  assert.equal(drawing.excalidraw_file_id, externalFileId);
  for (const [resource, resourceId, assetId] of [["note", fixture.noteId, note.id], ["drawing", fixture.drawingId, drawing.id]] as const) {
    const downloaded = await sdk.journal.assets.download({ resource, resourceId, assetId });
    assert.deepEqual(new Uint8Array(await downloaded.file.arrayBuffer()), bytes);
    assert.equal(downloaded.sha256, sha256);
  }
  corruptNextGet = true;
  await assert.rejects(sdk.journal.assets.download({ resource: "note", resourceId: fixture.noteId, assetId: note.id }), error => error instanceof AppRpcError && error.code === "asset_checksum");
  revokeAfterPut = true;
  const otherBytes = bytes.slice(); otherBytes[otherBytes.length - 1] = 42;
  await assert.rejects(sdk.journal.assets.upload({ resource: "note", resourceId: fixture.noteId, filename: "revoked.png", file: new File([otherBytes], "revoked.png", { type: "image/png" }) }));
  assert(calls.some(call => call.method === "notes.assets.finalize" && [401, 403].includes(call.status)), "The server must deny finalization after app revocation.");
  const count = calls.length;
  scope.close();
  await assert.rejects(sdk.journal.assets.download({ resource: "note", resourceId: fixture.noteId, assetId: note.id }), error => error instanceof AppRpcError && error.code === "app_closed");
  assert.equal(calls.length, count);
  await control("/_fixture/expire-and-cleanup");
  const statsResponse = await fetch(new URL("/__fixture__/stats", objects.endpoint), { headers: { Authorization: `Bearer ${objects.controlToken}` } });
  assert.equal(statsResponse.ok, true);
  const stats = await statsResponse.json() as { objects: number; requests: Array<{ method?: string; error?: string }> };
  assert(!stats.requests.some(request => request.error), "The object fixture must receive no credential leaks or malformed operations.");
  for (const method of ["PUT", "GET", "HEAD"]) assert(stats.requests.some(request => request.method === method), `Missing real storage ${method}.`);
  process.stdout.write(`PASS: SDK note/drawing upload, native RPC finalize, HTTPS download, byte/hash verification, corrupt-byte rejection, revocation before commit, and scope cleanup. ${calls.length} real RPC calls; ${stats.requests.length} object requests.\n`);
} catch (error) {
  process.stderr.write(`Journal network probe failed: ${error instanceof Error ? error.message.slice(0, 300) : "unexpected error"}\n`);
  process.exitCode = 1;
} finally { scope.close(); assets.close(); server.close(); }
