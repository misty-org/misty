import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// A candidate catalog lets integration probes verify a package before it is
// offered by Discover. The default still updates the normal local catalog.
const publicRoot = path.resolve(process.env.MISTY_OFFICIAL_APP_PUBLIC_DIR || path.join(root,"public"));
const catalogPath = process.env.MISTY_OFFICIAL_APP_CATALOG_PATH
  ? path.resolve(process.env.MISTY_OFFICIAL_APP_CATALOG_PATH)
  : path.join(root, "apps/catalog.json");
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const packagedApps = catalog.apps.filter(
  (app) =>
    app.desktop?.runtime === "downloaded" || app.mobile?.runtime === "hosted",
);
if (!packagedApps.length) {
  throw new Error(
    "No selected official apps currently provide downloadable packages.",
  );
}
const release = process.argv.includes("--release");
const selectedAppIds = new Set(
  process.argv.slice(2).filter((value) => !value.startsWith("--")),
);
const developmentSeed =
  "REDACTED_LEGACY_CREDENTIAL";
const keyId = release
  ? requiredEnvironment("MISTY_OFFICIAL_APP_SIGNING_KEY_ID")
  : "misty-development-2026-01";
const signingKey = privateKey(
  release
    ? requiredEnvironment("MISTY_OFFICIAL_APP_SIGNING_PRIVATE_KEY")
    : developmentSeed,
);
const publicKey = createPublicKey(signingKey);

for (const app of packagedApps) {
  if (selectedAppIds.size && !selectedAppIds.has(app.id)) continue;
  const versionRoot = path.join(
    publicRoot,
    "official-apps",
    app.id,
    app.version,
  );
  const desktopBuildRoot = path.join(
    root,
    ".build/official-apps",
    app.id,
    "desktop",
  );
  const mobileBuildRoot = path.join(
    root,
    ".build/official-apps",
    app.id,
    "mobile",
  );
  const desktopAssets = await readBuildAssets(
    desktopBuildRoot,
    app.id,
    "desktop",
  );
  assertBrowserRuntimeSafe(desktopAssets, app.id, "desktop");
  const definition = (await import(pathToFileURL(path.join(desktopBuildRoot, "app.js")).href)).default;
  if (definition?.protocol !== 2 || definition.appId !== app.id || typeof definition.mount !== "function") {
    throw new Error(`${app.id} must export an SDK protocol 2 component before it can be signed.`);
  }
  const files = [
    {
      name: `${app.id}/manifest.json`,
      data: json({
        schema_version: 3,
        id: app.id,
        name: app.name,
        version: app.version,
        description: app.description,
        author: "Misty",
        official: true,
        enabled: true,
        platforms: ["desktop"],
        runtime: { type: "mini-app", entry: "web/index.html", sdk: "2", component: "web/app.js" },
        runtime_capabilities: app.scopes,
        permission_version: app.permission_version,
        minimum_host_protocol: app.minimum_host_protocol,
        minimum_host_version: app.minimum_host_version,
        launcher: {
          views: ["sidebar", "workspace"],
          show_in_launcher: true,
          requires_selected_file: false,
          open_mode: "tab",
        },
        panels: [
          {
            id: `${app.id}.main`,
            title: app.name,
            window_type: "panel",
            entry: "web/index.html",
            launcher: { views: ["sidebar", "workspace"] },
          },
        ],
      }),
    },
    {
      name: `${app.id}/plugin.json`,
      data: json({
        schema_version: 1,
        id: app.id,
        name: app.name,
        version: app.version,
        author: "Misty",
        official: true,
        status: "installed",
        overview: app.description,
        capabilities: [app.description],
        where_it_appears: ["Desktop workspace"],
        permissions: app.scopes,
        runtime_capabilities: app.scopes,
        getting_started: [`Open ${app.name} from Apps.`],
        changelog: [],
        links: [],
        actions: [{ label: "Open", kind: "open" }],
        launcher: {
          views: ["sidebar", "workspace"],
          show_in_launcher: true,
          requires_selected_file: false,
          open_mode: "tab",
        },
      }),
    },
    ...desktopAssets.map((asset) => ({
      name: `${app.id}/web/${asset.name}`,
      data: asset.data,
    })),
  ];
  const archive = zip(files);
  const signature = sign(null, archive, signingKey);
  if (!verify(null, archive, publicKey, signature)) {
    throw new Error(`Generated signature did not verify for ${app.id}.`);
  }
  app.desktop = {
    runtime: "downloaded",
    entry: `https://apps.mistysys.com/official-apps/${app.id}/${app.version}/desktop.zip`,
    sha256: createHash("sha256").update(archive).digest("hex"),
    signature: signature.toString("base64"),
    signature_key_id: keyId,
    download_bytes: archive.length,
    additional_storage_bytes: files.reduce((total, file) => total + file.data.length, 0),
  };
  if (app.mobile.runtime === "hosted") {
    const mobileAssets = await readBuildAssets(
      mobileBuildRoot,
      app.id,
      "mobile",
    );
    assertBrowserRuntimeSafe(mobileAssets, app.id, "mobile");
    const mobileDocument = requiredAsset(
      mobileAssets,
      "index.html",
      app.id,
      "mobile",
    );
    const mobileStyles = requiredAsset(
      mobileAssets,
      "app.css",
      app.id,
      "mobile",
    );
    const mobileSignature = sign(null, mobileDocument.data, signingKey);
    await rm(versionRoot, { recursive: true, force: true });
    await mkdir(versionRoot, { recursive: true });
    for (const asset of mobileAssets) {
      const target = path.join(versionRoot, asset.name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, asset.data);
    }
    app.mobile = {
      runtime: "hosted",
      entry: `/official-apps/${app.id}/${app.version}/index.html`,
      sha256: createHash("sha256").update(mobileDocument.data).digest("hex"),
      style_sha256: createHash("sha256")
        .update(mobileStyles.data)
        .digest("hex"),
      signature: mobileSignature.toString("base64"),
      signature_key_id: keyId,
    };
  }
  await mkdir(versionRoot, { recursive: true });
  await writeFile(path.join(versionRoot, "desktop.zip"), archive);
}

catalog.signing = {
  key_id: keyId,
  public_key: rawPublicKey(publicKey).toString("base64"),
};
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
const builtCount = selectedAppIds.size
  ? packagedApps.filter((app) => selectedAppIds.has(app.id)).length
  : packagedApps.length;
console.log(
  `Built and signed ${builtCount} desktop app packages with ${keyId}.`,
);

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for an official release.`);
  return value;
}

function privateKey(value) {
  const trimmed = value.trim();
  const bytes = /^[a-f0-9]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  const der =
    bytes.length === 32
      ? Buffer.concat([
          Buffer.from("302e020100300506032b657004220420", "hex"),
          bytes,
        ])
      : bytes;
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

function rawPublicKey(key) {
  const der = key.export({ format: "der", type: "spki" });
  return der.subarray(-32);
}

function json(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function readBuildAssets(directory, appId, platform) {
  const result = [];
  await walk(directory, "", result).catch((error) => {
    throw new Error(
      `Missing real ${platform} package for ${appId}. Run npm run build:official-apps in the Misty app repository first.`,
      { cause: error },
    );
  });
  if (!result.some((asset) => asset.name === "index.html")) {
    throw new Error(
      `The ${platform} package for ${appId} did not produce index.html.`,
    );
  }
  return result;
}

function requiredAsset(assets, name, appId, platform) {
  const asset = assets.find((candidate) => candidate.name === name);
  if (!asset)
    throw new Error(
      `The ${platform} package for ${appId} did not produce ${name}.`,
    );
  return asset;
}

function assertBrowserRuntimeSafe(assets, appId, platform) {
  requiredAsset(assets, "app.js", appId, platform);
  const script = assets
    .filter((asset) => /\.m?js$/.test(asset.name))
    .map((asset) => asset.data.toString("utf8"))
    .join("\n");
  if (/\bprocess\.env\.NODE_ENV\b/.test(script)) {
    throw new Error(
      `${appId} ${platform} package contains an unresolved Node environment reference.`,
    );
  }
  if (/__MISTY_OFFICIAL_APP_PACKAGES__/.test(script)) {
    throw new Error(
      `${appId} ${platform} package contains a legacy injection primitive.`,
    );
  }
  const document = requiredAsset(
    assets,
    "index.html",
    appId,
    platform,
  ).data.toString("utf8");
  if (
    !/<script\s+type="module"[^>]+src="\.\/app\.js"[^>]*><\/script>/.test(
      document,
    ) ||
    !/connect-src 'none'/.test(document) ||
    /<script(?!\s+type="module")/i.test(document)
  ) {
    throw new Error(
      `${appId} ${platform} package must use the locked Misty ES-module document.`,
    );
  }
}

async function walk(directory, relative, output) {
  for (const entry of await readdir(path.join(directory, relative), {
    withFileTypes: true,
  })) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) await walk(directory, name, output);
    else if (entry.isFile())
      output.push({ name, data: await readFile(path.join(directory, name)) });
  }
}

// Minimal deterministic ZIP writer. Large production interfaces are deflated
// so the signed artifact remains practical to download and cache.
function zip(input) {
  const files = [...input].sort((a, b) => a.name.localeCompare(b.name));
  const local = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name.replaceAll("\\", "/"));
    const data = Buffer.from(file.data);
    const checksum = crc32(data);
    const compressed = deflateRawSync(data, { level: 9 });
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(33, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(33, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    local.push(localHeader, name, compressed);
    central.push(centralHeader, name);
    offset += localHeader.length + name.length + compressed.length;
  }
  const centralData = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralData, end]);
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}
