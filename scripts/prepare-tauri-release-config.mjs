import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const outputPath = path.join(root, "artifacts", "release", "tauri.release.conf.json");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for a signed desktop release.`);
  }
  return value;
}

function validateHttpsEndpoint(raw) {
  const endpoint = new URL(raw);
  if (endpoint.protocol !== "https:") {
    throw new Error("TAURI_UPDATER_ENDPOINT must use HTTPS.");
  }
  if (endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error("TAURI_UPDATER_ENDPOINT must not contain credentials or a fragment.");
  }
  return raw;
}

function requiredCspSources(name, protocols) {
  const sources = required(name).split(/[\s,]+/).filter(Boolean);
  return sources.map((source) => {
    if (source.includes("*")) {
      throw new Error(`${name} cannot contain wildcard sources.`);
    }
    const parsed = new URL(source);
    if (!protocols.includes(parsed.protocol)) {
      throw new Error(`${name} contains a disallowed protocol: ${parsed.protocol}`);
    }
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error(`${name} entries must be origins without credentials, paths, or queries.`);
    }
    return parsed.origin;
  });
}

const pubkey = required("TAURI_UPDATER_PUBLIC_KEY");
const keyLines = pubkey.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
if (
  keyLines.length > 2 ||
  !keyLines.at(-1)?.startsWith("RW") ||
  (keyLines.at(-1)?.length ?? 0) < 48
) {
  throw new Error("TAURI_UPDATER_PUBLIC_KEY must contain the generated Tauri public key.");
}

const connectSources = requiredCspSources("TAURI_CSP_CONNECT_SOURCES", ["https:", "wss:"]);
const imageSources = requiredCspSources("TAURI_CSP_IMAGE_SOURCES", ["https:"]);
const csp = [
  "default-src 'self' customprotocol: asset:",
  `connect-src 'self' ipc: asset: http://asset.localhost http://ipc.localhost ${connectSources.join(" ")}`,
  "frame-src 'self' asset: http://asset.localhost customprotocol: misty-extension: http://misty-extension.localhost",
  `img-src 'self' asset: http://asset.localhost blob: data: ${imageSources.join(" ")}`,
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "worker-src 'self' blob:",
].join("; ");

const windowsThumbprint = process.env.WINDOWS_CERTIFICATE_THUMBPRINT?.trim();
if (windowsThumbprint && !/^[A-F0-9]{40}$/i.test(windowsThumbprint)) {
  throw new Error("WINDOWS_CERTIFICATE_THUMBPRINT must be a 40-character hexadecimal value.");
}
const windowsTimestampUrl = process.env.WINDOWS_TIMESTAMP_URL?.trim();
if (windowsThumbprint && !windowsTimestampUrl) {
  throw new Error("WINDOWS_TIMESTAMP_URL is required when Windows signing is configured.");
}
if (windowsTimestampUrl) validateHttpsEndpoint(windowsTimestampUrl);

const config = {
  app: {
    security: {
      csp,
    },
  },
  bundle: {
    createUpdaterArtifacts: true,
    ...(windowsThumbprint
      ? {
          windows: {
            certificateThumbprint: windowsThumbprint,
            digestAlgorithm: "sha256",
            timestampUrl: windowsTimestampUrl,
          },
        }
      : {}),
  },
  plugins: {
    updater: {
      pubkey,
      endpoints: [validateHttpsEndpoint(required("TAURI_UPDATER_ENDPOINT"))],
      windows: {
        installMode: "passive",
      },
    },
  },
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
console.log(path.relative(root, outputPath));
