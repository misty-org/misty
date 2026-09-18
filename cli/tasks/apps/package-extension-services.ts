import { createPrivateKey } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { nativeServicesForApp, packageNativeServices } from "./package-native-services.ts";

export async function packageExtensionServices(root, app, destination, { release = false, platform } = {}) {
  if (!nativeServicesForApp(app.id).length) return;
  const seed = release ? process.env.MISTY_OFFICIAL_APP_SIGNING_PRIVATE_KEY : "REDACTED_LEGACY_CREDENTIAL";
  const keyId = release ? process.env.MISTY_OFFICIAL_APP_SIGNING_KEY_ID : "misty-development-2026-01";
  if (!seed || !keyId) throw new Error("Configure the official native service signing key before release packaging.");
  const key = seed.includes("BEGIN") ? createPrivateKey(seed) : createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seed, /^[a-f0-9]{64}$/i.test(seed) ? "hex" : "base64")]), format: "der", type: "pkcs8" });
  for (const file of await packageNativeServices(root, app, key, keyId, { release })) {
    if (platform && !file.name.includes(`/${platform}/`)) continue;
    const target = path.join(destination, file.name.slice(app.id.length + 1));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.data);
  }
}
