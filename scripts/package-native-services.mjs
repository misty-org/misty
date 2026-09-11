import { createHash, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const servicesByApp = new Map([
  ["files", [["document-processing", 5], ["file-search", 1], ["peer-transport", 2], ["file-operations", 1]]],
  ["storage_report", [["file-operations", 1]]],
  ["backups", [["backup-archive", 1]]],
  ["library", [["document-processing", 5]]],
  ["terminal", [["terminal", 1]]],
  ["code", [["code-tools", 1], ["file-operations", 1]]],
]);
export function nativeServicesForApp(appId) {
  return (servicesByApp.get(appId) ?? []).map(([service, protocol]) => [service, protocol]);
}
export const nativeServicePlatforms = ["macos-aarch64", "macos-x86_64"];

/** Native services travel with the owning release; mobile packages never include them. */
export async function packageNativeServices(root, app, signingKey, keyId, { release = false } = {}) {
  const files = [];
  const services = nativeServicesForApp(app.id);
  for (const [service, protocol] of services) {
  const before=files.length;
  for (const platform of nativeServicePlatforms) {
    let worker;
    try {
      worker = await readFile(path.join(root, ".build/native-services",service, platform, "worker"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (release) throw new Error(`Build ${service} for ${platform} before packaging ${app.id} for release.`);
      continue;
    }
    if (!worker.length || worker.length > 64 * 1024 * 1024) throw new Error("Invalid native service size.");
    const payload = JSON.stringify({
      protocol, service, appId: app.id, appVersion: app.version,
      platform, sha256: createHash("sha256").update(worker).digest("hex"), bytes: worker.length,
    });
    const signature = sign(null, Buffer.from(`misty-native-service-v1\n${payload}`), signingKey).toString("base64");
    const prefix = `${app.id}/native/${service}/${platform}`;
    files.push({ name: `${prefix}/worker`, data: worker }, {
      name: `${prefix}/service.json`, data: Buffer.from(JSON.stringify({payload, signature, signatureKeyId: keyId})),
    });
  }
  if (files.length === before) throw new Error(`Build the ${service} native service before packaging ${app.id}.`);
  }
  return files;
}
