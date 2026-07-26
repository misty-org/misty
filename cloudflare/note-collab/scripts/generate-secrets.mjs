/**
 * Generates the note-collaboration secrets.
 *
 * Run once. Values are written to local gitignored files and printed only as
 * the commands you paste elsewhere -- never to stdout in full.
 *
 *   node scripts/generate-secrets.mjs
 *
 * The Ed25519 keypair is asymmetric on purpose: Cloudflare receives only the
 * public half, so a compromise there cannot mint collaboration tickets.
 */
import { webcrypto as crypto } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function base64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function randomSecret() {
  return base64(crypto.getRandomValues(new Uint8Array(32)));
}

const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const privatePkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));

// Prove the pair actually round-trips before anything is written. A mismatched
// pair would fail only at connection time, which is a miserable way to find out.
const probe = new TextEncoder().encode("misty-note-collab-keycheck");
const signature = await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, probe);
const verified = await crypto.subtle.verify({ name: "Ed25519" }, pair.publicKey, signature, probe);
if (!verified) {
  console.error("generated keypair failed its own verification; aborting");
  process.exit(1);
}
if (publicRaw.byteLength !== 32) {
  console.error(`public key is ${publicRaw.byteLength} bytes, expected 32; aborting`);
  process.exit(1);
}

const secrets = {
  NOTE_COLLAB_TICKET_PUBLIC_KEY: base64(publicRaw),
  NOTE_COLLAB_TICKET_PRIVATE_KEY: base64(privatePkcs8),
  NOTE_COLLAB_CONTROL_SECRET: randomSecret(),
  NOTE_COLLAB_PROJECTION_SECRET: randomSecret(),
};

// .dev.vars is what `wrangler dev` reads for local runs. It is gitignored.
const devVars = [
  `NOTE_COLLAB_TICKET_PUBLIC_KEY=${secrets.NOTE_COLLAB_TICKET_PUBLIC_KEY}`,
  `NOTE_COLLAB_CONTROL_SECRET=${secrets.NOTE_COLLAB_CONTROL_SECRET}`,
  `NOTE_COLLAB_PROJECTION_SECRET=${secrets.NOTE_COLLAB_PROJECTION_SECRET}`,
  "",
].join("\n");
writeFileSync(resolve(projectRoot, ".dev.vars"), devVars, { mode: 0o600 });

// The private key never goes to Cloudflare. This file is for the VPS only.
mkdirSync(resolve(projectRoot, ".secrets"), { recursive: true });
const goEnv = [
  "# Append to the Misty server environment on the VPS.",
  "# NOTE_COLLAB_TICKET_PRIVATE_KEY must never be given to Cloudflare.",
  `NOTE_COLLAB_TICKET_PRIVATE_KEY=${secrets.NOTE_COLLAB_TICKET_PRIVATE_KEY}`,
  `NOTE_COLLAB_CONTROL_SECRET=${secrets.NOTE_COLLAB_CONTROL_SECRET}`,
  `NOTE_COLLAB_PROJECTION_SECRET=${secrets.NOTE_COLLAB_PROJECTION_SECRET}`,
  "MISTY_NOTES_COLLAB_ENABLED=true",
  "",
].join("\n");
writeFileSync(resolve(projectRoot, ".secrets/server.env"), goEnv, { mode: 0o600 });

// A local-only ticket signing key for the demo harness, so the harness can
// mint tickets before the Go endpoint exists.
writeFileSync(
  resolve(projectRoot, ".secrets/signing-key.json"),
  `${JSON.stringify({ privatePkcs8Base64: secrets.NOTE_COLLAB_TICKET_PRIVATE_KEY, publicRawBase64: secrets.NOTE_COLLAB_TICKET_PUBLIC_KEY }, null, 2)}\n`,
  { mode: 0o600 },
);

console.log("Wrote:");
console.log("  .dev.vars                 (wrangler dev picks this up automatically)");
console.log("  .secrets/server.env       (paste into the VPS environment)");
console.log("  .secrets/signing-key.json (local demo harness only)");
console.log("");
console.log("To set the deployed Worker's secrets, run these and paste the value");
console.log("from .dev.vars / .secrets/server.env when prompted:");
console.log("");
console.log("  npx wrangler secret put NOTE_COLLAB_TICKET_PUBLIC_KEY");
console.log("  npx wrangler secret put NOTE_COLLAB_CONTROL_SECRET");
console.log("  npx wrangler secret put NOTE_COLLAB_PROJECTION_SECRET");
