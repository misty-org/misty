/**
 * Proves a real multiplayer session end to end.
 *
 * Two independent Yjs documents connect to the same Journal room as different
 * users, edit concurrently, and must converge on identical text. A third
 * client connects as a viewer and must be refused the ability to write.
 *
 *   node scripts/demo-multiplayer.mjs [worker-origin] [note|drawing]
 *
 * Defaults to the local `wrangler dev` origin. Pass the deployed origin to run
 * the same check against Cloudflare.
 *
 * Tickets are minted here with the same Ed25519 key the Go server will use, so
 * this exercises the real authorization path rather than a bypass.
 */
import { webcrypto as crypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as Y from "yjs";
import YProvider from "y-partyserver/provider";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const origin = process.argv[2] ?? "http://127.0.0.1:8787";
const resourceType = process.argv[3] ?? "note";
if (resourceType !== "note" && resourceType !== "drawing") {
  console.error("Resource type must be note or drawing.");
  process.exit(2);
}
const RESOURCE_ID = `${resourceType}_demo`;
const ROOM = `${resourceType}_demo_room_0001`;

const keys = JSON.parse(
  readFileSync(resolve(projectRoot, ".secrets/signing-key.json"), "utf8"),
);

function base64UrlFromBytes(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

async function signingKey() {
  return crypto.subtle.importKey(
    "pkcs8",
    Buffer.from(keys.privatePkcs8Base64, "base64"),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
}

async function mintTicket(key, { userID, role, aclVersion = 1 }) {
  const header = base64UrlFromBytes(
    Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })),
  );
  const claims = {
    iss: "misty-api",
    aud: "misty-journal-collab",
    // Single-use: every connection needs its own id or the room rejects it.
    jti: `demo-${crypto.randomUUID()}`,
    sub: userID,
    space_id: "space_demo",
    resource_type: resourceType,
    resource_id: RESOURCE_ID,
    [`${resourceType}_id`]: RESOURCE_ID,
    room: ROOM,
    role,
    acl_version: aclVersion,
    exp: Math.floor(Date.now() / 1000) + 60,
  };
  const payload = base64UrlFromBytes(Buffer.from(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

function connect(ticket) {
  const doc = new Y.Doc();
  const url = new URL(origin);
  // The provider wants host[:port] plus an explicit protocol, not a full URL.
  const provider = new YProvider(url.host, ROOM, doc, {
    party: `${resourceType}-room`,
    protocol: url.protocol === "https:" ? "wss" : "ws",
    params: { ticket },
  });
  return { doc, provider };
}

function waitForSync(provider, label, timeoutMs = 10000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(
      () => rejectPromise(new Error(`${label}: sync timed out`)),
      timeoutMs,
    );
    provider.on("synced", (isSynced) => {
      if (isSynced) {
        clearTimeout(timer);
        resolvePromise();
      }
    });
    provider.on("connection-error", (event) => {
      clearTimeout(timer);
      rejectPromise(
        new Error(
          `${label}: refused (${event?.code ?? "unknown"}) ${event?.reason ?? ""}`,
        ),
      );
    });
  });
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const key = await signingKey();
  console.log(
    `connecting to ${origin} resource=${resourceType} room=${ROOM}\n`,
  );

  const alice = connect(
    await mintTicket(key, { userID: "user_alice", role: "editor" }),
  );
  const bob = connect(
    await mintTicket(key, { userID: "user_bob", role: "editor" }),
  );

  await Promise.all([
    waitForSync(alice.provider, "alice"),
    waitForSync(bob.provider, "bob"),
  ]);
  console.log("✓ both editors connected and synced");

  // Concurrent edits from both ends of the document.
  alice.doc.getText("body").insert(0, "Alice writes first. ");
  bob.doc.getText("body").insert(0, "Bob writes too. ");
  await settle(1500);

  const aliceText = alice.doc.getText("body").toString();
  const bobText = bob.doc.getText("body").toString();
  console.log(`  alice sees: ${JSON.stringify(aliceText)}`);
  console.log(`  bob   sees: ${JSON.stringify(bobText)}`);

  if (aliceText !== bobText) {
    console.error("\n✗ FAILED: the two clients did not converge");
    process.exit(1);
  }
  if (
    !aliceText.includes("Alice writes") ||
    !aliceText.includes("Bob writes")
  ) {
    console.error("\n✗ FAILED: converged text is missing one client's edit");
    process.exit(1);
  }
  console.log("✓ concurrent edits converged to identical text");

  // A viewer may read the document but must not be able to change it.
  const carol = connect(
    await mintTicket(key, { userID: "user_carol", role: "viewer" }),
  );
  await waitForSync(carol.provider, "carol");
  console.log("✓ viewer connected and received document state");
  if (!carol.doc.getText("body").toString().includes("Alice writes")) {
    console.error("\n✗ FAILED: viewer did not receive existing content");
    process.exit(1);
  }

  carol.doc.getText("body").insert(0, "Carol should not be able to write. ");
  await settle(1500);
  if (alice.doc.getText("body").toString().includes("Carol should not")) {
    console.error("\n✗ FAILED: a viewer's edit reached other clients");
    process.exit(1);
  }
  console.log("✓ viewer's edit was rejected and never reached the editors");

  // A replayed ticket must be refused.
  const replayTicket = await mintTicket(key, {
    userID: "user_dave",
    role: "editor",
  });
  const first = connect(replayTicket);
  await waitForSync(first.provider, "dave");
  const replay = connect(replayTicket);
  const replayed = await waitForSync(replay.provider, "dave-replay", 4000).then(
    () => true,
    () => false,
  );
  if (replayed) {
    console.error("\n✗ FAILED: a reused ticket was accepted");
    process.exit(1);
  }
  console.log("✓ replayed ticket refused");

  for (const client of [alice, bob, carol, first, replay])
    client.provider.destroy();
  console.log("\nAll multiplayer checks passed.");
  process.exit(0);
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
});
