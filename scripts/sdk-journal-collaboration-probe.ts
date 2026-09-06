/** Real SDK → scoped host RPC → native Hono/PostgreSQL → managed Worker proof.
 * Requires sdk-journal-collaboration-fixture.mjs; all accounts/data are disposable.
 * This exercises the production collaboration adapters, not the rendered host UI.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createMistyAppSDK, isMistyCollaborationMethod } from "@misty/sdk";
import { connectMistyYjs } from "@misty/sdk/yjs";
import * as Y from "yjs";
import { createAppRpcScope } from "../src/features/apps/rpc/session";
import { createServerRpc } from "../src/features/apps/rpc/server";
import { createCollaborationRpc } from "../src/features/apps/rpc/collaboration";

type Fixture = {
  apiBase: string;
  appToken: string;
  secondToken: string;
  userId: string;
  controlToken: string;
  controlBase: string;
  spaceId: string;
  noteId: string;
  drawingId: string;
};
const fixture: Fixture = JSON.parse(await readFile(process.argv[2], "utf8"));
assert.equal(new URL(fixture.apiBase).hostname, "127.0.0.1");
assert.equal(new URL(fixture.controlBase).origin, new URL(fixture.apiBase).origin);
const methods = new Set<string>();
const clients: ReturnType<typeof client>[] = [];
const documents: Y.Doc[] = [];
const connections: Awaited<ReturnType<typeof connectMistyYjs>>[] = [];
async function until(check: () => boolean | Promise<boolean>, description: string) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(30);
  }
  throw new Error(`Timed out: ${description}`);
}
function client(token: string) {
  const lifetime = new AbortController();
  const scope = createAppRpcScope({
    identity: {
      appId: "journal",
      accountId: fixture.userId,
      spaceId: fixture.spaceId,
      instanceId: crypto.randomUUID(),
    },
    scopes: ["notes.read", "notes.write", "drawings.read", "drawings.write", "spaces.read"],
    expiresAt: new Date(Date.now() + 240000).toISOString(),
    isCurrentAccount: () => true,
  });
  const server = createServerRpc(scope, {
    serverBase: fixture.apiBase,
    readAppSession: () => ({ appId: "journal", spaceId: fixture.spaceId, token }),
    fetch: async (url, init) => {
      methods.add(JSON.parse(String(init?.body)).method);
      return fetch(url, init);
    },
  });
  const sockets: WebSocket[] = [];
  const collaboration = createCollaborationRpc(scope, {
    ticket: (resource, resourceId, signal) =>
      server.request(
        {
          method:
            resource === "note" ? "notes.collaboration.ticket" : "drawings.collaboration.ticket",
          params: {
            path: resource === "note" ? { noteID: resourceId } : { drawingID: resourceId },
          },
        },
        { signal },
      ),
    socket: (url) => {
      assert(["127.0.0.1", "localhost"].includes(new URL(url).hostname));
      const socket = new WebSocket(url);
      sockets.push(socket);
      return socket;
    },
  });
  const sdk = createMistyAppSDK({
    request: (message) =>
      message.method === "lifecycle.ready"
        ? Promise.resolve()
        : isMistyCollaborationMethod(message.method)
          ? collaboration.request(message)
          : server.request(message),
    subscribe: (topic, listener) => collaboration.subscribe(topic, listener),
  });
  return {
    sdk,
    sockets,
    lifetime,
    close() {
      lifetime.abort();
      collaboration.close();
      server.close();
      scope.close();
    },
  };
}
async function connect(
  owner: ReturnType<typeof client>,
  resource: "note" | "drawing",
  resourceId: string,
) {
  const doc = new Y.Doc();
  documents.push(doc);
  const connection = await connectMistyYjs(owner.sdk.collaboration, {
    resource,
    resourceId,
    doc,
    signal: owner.lifetime.signal,
  });
  connections.push(connection);
  await until(() => connection.provider.synced, `${resource} synchronized through SDK lease`);
  return { doc, ...connection };
}
async function control(action: string) {
  const response = await fetch(`${fixture.controlBase}/${action}`, {
    method: "POST",
    headers: { "X-Fixture-Control": fixture.controlToken },
    redirect: "error",
  });
  assert.equal(response.ok, true, `Fixture control ${action}`);
  return response.json();
}
try {
  const first = client(fixture.appToken),
    second = client(fixture.secondToken);
  clients.push(first, second);
  assert((await first.sdk.notes.list()).some((note) => note.id === fixture.noteId));
  assert((await second.sdk.drawings.list()).some((drawing) => drawing.id === fixture.drawingId));
  const members = await first.sdk.server.call("spaces.members.list");
  assert(members.members?.some((member) => member.user_id === fixture.userId));
  const noteA = await connect(first, "note", fixture.noteId);
  const noteB = await connect(second, "note", fixture.noteId);
  const title = `SDK collaboration ${crypto.randomUUID()}`;
  noteA.doc.transact(() => {
    const text = noteA.doc.getText("misty:title");
    text.delete(0, text.length);
    text.insert(0, title);
    noteA.doc.getText("misty:markdown").insert(0, "# Saved through the SDK\n\nFirst client.");
  });
  await until(
    () => noteB.doc.getText("misty:title").toString() === title,
    "first client edit reaches second",
  );
  noteB.doc
    .getText("misty:markdown")
    .insert(noteB.doc.getText("misty:markdown").length, "\n\nSecond client.");
  await until(
    () => noteA.doc.getText("misty:markdown").toString().includes("Second client."),
    "second client edit reaches first",
  );
  await until(async () => {
    const note = await first.sdk.notes.get(fixture.noteId);
    return note.title === title && Boolean(note.markdown?.includes("Second client."));
  }, "signed Worker projection persisted in PostgreSQL and read through SDK");
  assert((await control("state")).projections > 0);
  noteB.destroy();
  const reopened = await connect(second, "note", fixture.noteId);
  assert.equal(reopened.doc.getText("misty:title").toString(), title);
  assert(reopened.doc.getText("misty:markdown").toString().includes("Second client."));

  const drawingA = await connect(first, "drawing", fixture.drawingId);
  const drawingB = await connect(second, "drawing", fixture.drawingId);
  drawingA.doc
    .getMap("elements")
    .set("sdk-proof", { id: "sdk-proof", type: "rectangle", x: 10, y: 20 });
  await until(
    () => drawingB.doc.getMap("elements").has("sdk-proof"),
    "drawing edit reaches second client",
  );
  const lease = await first.sdk.collaboration.open({
    resource: "drawing",
    resourceId: fixture.drawingId,
  });
  await assert.rejects(
    second.sdk.collaboration.close(lease.handle),
    "A view cannot close another view's lease",
  );
  await until(
    () => first.sockets[first.sockets.length - 1]?.readyState === WebSocket.OPEN,
    "explicit lease handshake completes",
  );
  await first.sdk.collaboration.close(lease.handle);
  await until(
    () => first.sockets[first.sockets.length - 1]?.readyState === WebSocket.CLOSED,
    "explicitly released lease closes its socket",
  );

  // Archive updates the database ACL and the real durable control outbox.
  noteA.provider.shouldConnect = false;
  reopened.provider.shouldConnect = false;
  await first.sdk.notes.archive(fixture.noteId);
  await control("controls");
  await until(
    () => !noteA.provider.wsconnected && !reopened.provider.wsconnected,
    "archive disconnects stale document sockets",
  );
  await assert.rejects(
    second.sdk.collaboration.open({ resource: "note", resourceId: fixture.noteId }),
  );

  await control("revoke");
  await assert.rejects(first.sdk.drawings.get(fixture.drawingId));
  await assert.rejects(
    first.sdk.collaboration.open({ resource: "drawing", resourceId: fixture.drawingId }),
  );
  assert.equal((await second.sdk.drawings.get(fixture.drawingId)).id, fixture.drawingId);
  first.close();
  await until(
    () => first.sockets.every((socket) => socket.readyState === WebSocket.CLOSED),
    "closed mount releases every native host socket",
  ).catch((error) => {
    console.error(
      "Host socket ready states:",
      first.sockets.map((socket) => socket.readyState),
    );
    throw error;
  });
  assert(drawingB.provider.wsconnected, "Closing one mount preserves the other mount");
  await assert.rejects(first.sdk.notes.list());
  console.log(
    `PASS: two SDK clients, note/drawing propagation, real signed PostgreSQL projection, reopen, cross-view lease isolation, archive ACL disconnect, revoked session denial, mount cleanup. ${methods.size} native RPC methods.`,
  );
} finally {
  for (const connection of connections) connection.destroy();
  for (const owner of clients) owner.close();
  for (const doc of documents) doc.destroy();
}
