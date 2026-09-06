import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = await json("package.json");
const index = await json("catalog/index.json");
const interfaceManifest = await json("interface/manifest.json");
const officialCatalog = await json("apps/catalog.json");
const ids = new Set();
const capabilityContracts = {
  storage_report: ["files.read"],
  themes: ["appearance.write"],
  image_optimizer: ["files.read", "files.write"],
  quick_convert: ["files.read", "files.write", "media.convert"],
  backups: ["files.read", "files.write", "backups.manage"],
  ytdlp: ["files.write", "media.download"],
};
const pluginSources = {
  storage_report: "storageReport/StorageReportPlugin.tsx",
  themes: "themes/ThemesPlugin.tsx",
  image_optimizer: "imageOptimizer/ImageOptimizerPlugin.tsx",
  quick_convert: "quickConvert/QuickConvertPlugin.tsx",
  backups: "backups/BackupsPlugin.tsx",
  ytdlp: "ytdlp/YtdlpPlugin.tsx",
};
const releasePlatforms = ["macos-aarch64", "macos-x86_64"];

await validateOfficialApps(officialCatalog);

if (
  interfaceManifest.schemaVersion !== 1 ||
  !Array.isArray(interfaceManifest.files)
) {
  fail("interface/manifest.json must declare the supported interface files.");
}
for (const fileName of interfaceManifest.files) {
  if (typeof fileName !== "string" || path.basename(fileName) !== fileName) {
    fail(`Unsafe extension interface file: ${fileName}`);
  }
  if (!(await stat(path.join(repo, "interface", fileName)).catch(() => null))) {
    fail(`Missing interface/${fileName}.`);
  }
}

if (!Array.isArray(index) || index.length === 0)
  fail("catalog/index.json must contain extensions.");
for (const entry of index) {
  if (!entry || typeof entry.id !== "string" || ids.has(entry.id))
    fail(`Invalid or duplicate catalog id: ${entry?.id}`);
  ids.add(entry.id);
  const expectedUrl = `https://raw.githubusercontent.com/misty-org/misty-extensions/main/catalog/${entry.id}.json`;
  if (entry.url !== expectedUrl)
    fail(`${entry.id} catalog URL must be ${expectedUrl}`);
}

const extensionDirs = (
  await readdir(path.join(repo, "extensions"), { withFileTypes: true })
)
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((id) => ids.has(id));
for (const id of ids) {
  if (!extensionDirs.includes(id)) fail(`Missing extensions/${id}.`);
  const manifest = await json(`extensions/${id}/manifest.json`);
  const detail = await json(`extensions/${id}/plugin.json`);
  const catalog = await json(`catalog/${id}.json`);
  for (const [name, value] of [
    ["manifest", manifest],
    ["plugin detail", detail],
  ]) {
    if (value.id !== id) fail(`${id} ${name} id does not match its directory.`);
    if (value.version !== packageJson.version)
      fail(`${id} ${name} version must be ${packageJson.version}.`);
  }
  if (catalog.version !== packageJson.version)
    fail(`${id} catalog version must be ${packageJson.version}.`);
  const panel = manifest.panels?.[0];
  if (!panel?.entry?.startsWith("web/index.html?plugin="))
    fail(`${id} must advertise a self-contained web panel entry.`);
  if (
    manifest.launcher?.open_mode !== "tab" ||
    catalog.launcher?.open_mode !== "tab"
  ) {
    fail(`${id} must use the workspace app-tab launcher contract.`);
  }
  if (
    !Array.isArray(catalog.install?.artifacts) ||
    catalog.install.artifacts.length === 0
  )
    fail(`${id} must have release artifacts.`);
  if (
    JSON.stringify(
      catalog.install.artifacts.map((artifact) => artifact.platform),
    ) !== JSON.stringify(releasePlatforms)
  ) {
    fail(
      `${id} may publish only ${releasePlatforms.join(", ")} until other native App adapters are validated.`,
    );
  }
  for (const artifact of catalog.install.artifacts) {
    if (
      !artifact.url?.includes(
        `/releases/download/v${packageJson.version}/${id}-${artifact.platform}.zip`,
      )
    )
      fail(
        `${id} has an artifact URL for the wrong release or platform bundle.`,
      );
  }
  const tools = manifest.tools ?? [];
  const expectedCapabilities = capabilityContracts[id];
  if (
    JSON.stringify(manifest.runtime_capabilities ?? []) !==
      JSON.stringify(expectedCapabilities) ||
    JSON.stringify(detail.runtime_capabilities ?? []) !==
      JSON.stringify(expectedCapabilities) ||
    JSON.stringify(catalog.runtime_capabilities ?? []) !==
      JSON.stringify(expectedCapabilities)
  ) {
    fail(
      `${id} manifest, plugin detail, and catalog must declare ${expectedCapabilities.join(", ")}.`,
    );
  }
  if (tools.length || (detail.included_tools ?? []).length) {
    fail(
      `${id} must use Host-owned capability services instead of package executables.`,
    );
  }
  const pluginSource = await readFile(
    path.join(repo, "src/plugins", pluginSources[id]),
    "utf8",
  );
  if (/runHostCommand|usePluginJob|host\.pickFolders/.test(pluginSource)) {
    fail(`${id} still calls the legacy extension command broker.`);
  }
  for (const tool of tools) {
    if (
      !tool.id ||
      !tool.version ||
      !["macos", "windows", "linux"].includes(tool.platform) ||
      !["aarch64", "x86_64"].includes(tool.architecture)
    )
      fail(`${id} has an invalid tool variant.`);
    if (
      !tool.path ||
      path.isAbsolute(tool.path) ||
      tool.path
        .split(/[\\/]/)
        .some((part) => !part || part === "." || part === "..")
    )
      fail(`${id} has an unsafe tool path.`);
  }
  if (
    tools.length &&
    !(await stat(
      path.join(repo, `extensions/${id}/THIRD_PARTY_NOTICES.md`),
    ).catch(() => null))
  )
    fail(`${id} must include third-party notices.`);
}

const sourceFiles = await sourceFilesBelow(path.join(repo, "src"));
const forbidden =
  /(?:text|bg|border)-(?:zinc|neutral|slate|gray)-|#(?:090c10|e4e4e7|adadad|eeeeee)\b/i;
for (const file of sourceFiles.filter(
  (file) =>
    /\.(?:tsx|css)$/.test(file) &&
    !file.endsWith("ThemesPlugin.tsx") &&
    !file.includes(`${path.sep}previewPanel${path.sep}`) &&
    !file.includes(`${path.sep}vault${path.sep}`),
)) {
  const source = await readFile(file, "utf8");
  if (forbidden.test(source))
    fail(
      `${path.relative(repo, file)} contains a hardcoded neutral instead of a semantic Misty token.`,
    );
}

console.log(
  `Validated ${ids.size} extension entries and ${officialCatalog.apps.length} official apps at v${packageJson.version}.`,
);

async function validateOfficialApps(catalog) {
  if (
    catalog.schema_version !== 1 ||
    catalog.host_protocol_version !== 2 ||
    !Array.isArray(catalog.apps)
  ) {
    fail(
      "apps/catalog.json must use official app schema version 1 and host protocol version 2.",
    );
  }
  const expected = [
    "chat",
    "journal",
    "planner",
    "library",
    "inbox",
    "agents",
    "files",
    "browser",
    "code",
    "terminal",
  ];
  if (catalog.apps.some(app => app.desktop?.runtime === "downloaded") &&
      (!catalog.signing?.key_id || !catalog.signing?.public_key)) {
    fail("Downloaded official apps must declare a signing key.");
  }
  const appIds = catalog.apps.map((app) => app?.id);
  if (JSON.stringify(appIds) !== JSON.stringify(expected)) {
    fail(`Official app ids must be ${expected.join(", ")} in product order.`);
  }
  for (const app of catalog.apps) {
    if (
      app.app_id !== `com.misty.${app.slug}` ||
      !/^[a-z][a-z0-9-]*$/.test(app.slug ?? "")
    ) {
      fail(
        `${app.id} must declare its immutable reverse-domain id and friendly slug.`,
      );
    }
    if (
      !app.name ||
      app.publisher !== "Misty" ||
      app.official !== true ||
      !/^\d+\.\d+\.\d+$/.test(app.version ?? "")
    ) {
      fail(`Invalid official app identity for ${app.id}.`);
    }
    if (
      !Number.isInteger(app.permission_version) ||
      app.permission_version < 1 ||
      ![1, 2].includes(app.minimum_host_protocol) ||
      !Array.isArray(app.scopes)
    ) {
      fail(`Invalid official app protocol contract for ${app.id}.`);
    }
    if (app.desktop?.runtime === "downloaded") {
      if (app.minimum_host_protocol !== 2 ||
          app.desktop.entry !== `https://apps.mistysys.com/official-apps/${app.id}/${app.version}/desktop.zip` ||
          !/^[a-f0-9]{64}$/.test(app.desktop.sha256 ?? "") ||
          Buffer.from(app.desktop.signature ?? "", "base64").length !== 64 ||
          app.desktop.signature_key_id !== catalog.signing.key_id) {
        fail(`${app.id} must declare a signed SDK protocol 2 component package.`);
      }
    } else if (app.desktop?.runtime !== "embedded" || Object.keys(app.desktop).length !== 1) {
      fail(`${app.id} must use an embedded or verified downloaded desktop runtime.`);
    }
    const expectedMobile = ["code", "terminal"].includes(app.id)
      ? "unsupported"
      : "embedded";
    if (app.mobile?.runtime !== expectedMobile)
      fail(`${app.id} has an invalid mobile Host runtime.`);
    if (Object.keys(app.mobile).length !== 1)
      fail(`${app.id} mobile runtime must not advertise package assets.`);
  }
  for (const id of ["code", "terminal"]) {
    if (
      catalog.apps.find((app) => app.id === id)?.mobile.runtime !==
      "unsupported"
    ) {
      fail(`${id} must remain desktop only.`);
    }
  }
}

async function json(relative) {
  try {
    return JSON.parse(await readFile(path.join(repo, relative), "utf8"));
  } catch (error) {
    fail(`${relative} is not valid JSON: ${error.message}`);
  }
}
function fail(message) {
  throw new Error(message);
}
async function sourceFilesBelow(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const current = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await sourceFilesBelow(current)));
    else result.push(current);
  }
  return result;
}
