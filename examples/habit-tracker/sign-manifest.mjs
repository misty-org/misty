import { createHash, generateKeyPairSync, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { installDocument } from "./manifest.mjs";

process.umask(0o077);
const directory = resolve(process.argv[2] ?? "./private");
mkdirSync(directory, { recursive: true, mode: 0o700 });
const filename = resolve(directory, "publisher.pem");
if (!existsSync(filename)) {
  const { privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(filename, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
}
const privateKey = createPrivateKey(readFileSync(filename));
if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("The publisher key must be Ed25519.");
const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "der" }).subarray(-32);
const document = JSON.stringify(installDocument);
const manifest = { document, publicKey: publicKey.toString("base64"), signature: sign(null, Buffer.from(`misty.sdk.manifest.v1\n${document}`), privateKey).toString("base64") };
const reviewedDigest = createHash("sha256").update(document).digest("hex");
const output = resolve(directory, "installation.json");
writeFileSync(output, JSON.stringify({ manifest, reviewedDigest }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ installationFile: output, reviewedDigest }, null, 2));
