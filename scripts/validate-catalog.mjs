import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = await json("package.json");
const index = await json("catalog/index.json");
const ids = new Set();

if (!Array.isArray(index) || index.length === 0) fail("catalog/index.json must contain extensions.");
for (const entry of index) {
  if (!entry || typeof entry.id !== "string" || ids.has(entry.id)) fail(`Invalid or duplicate catalog id: ${entry?.id}`);
  ids.add(entry.id);
  const expectedUrl = `https://raw.githubusercontent.com/misty-org/misty/main/extensions/catalog/${entry.id}.json`;
  if (entry.url !== expectedUrl) fail(`${entry.id} catalog URL must be ${expectedUrl}`);
}

const extensionDirs = (await readdir(path.join(repo, "extensions"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name).filter((id) => ids.has(id));
for (const id of ids) {
  if (!extensionDirs.includes(id)) fail(`Missing extensions/${id}.`);
  const manifest = await json(`extensions/${id}/manifest.json`);
  const detail = await json(`extensions/${id}/plugin.json`);
  const catalog = await json(`catalog/${id}.json`);
  for (const [name, value] of [["manifest", manifest], ["plugin detail", detail]]) {
    if (value.id !== id) fail(`${id} ${name} id does not match its directory.`);
    if (value.version !== packageJson.version) fail(`${id} ${name} version must be ${packageJson.version}.`);
  }
  if (catalog.version !== packageJson.version) fail(`${id} catalog version must be ${packageJson.version}.`);
  const panel = manifest.panels?.[0];
  if (!panel?.entry?.startsWith("web/index.html?plugin=")) fail(`${id} must advertise a self-contained web panel entry.`);
  if (manifest.launcher?.open_mode !== "popup" || catalog.launcher?.open_mode !== "popup") {
    fail(`${id} must use the first-party popup launcher contract.`);
  }
  if (!Array.isArray(catalog.install?.artifacts) || catalog.install.artifacts.length === 0) fail(`${id} must have release artifacts.`);
  for (const artifact of catalog.install.artifacts) {
    if (!artifact.url?.includes(`/releases/download/extensions-v${packageJson.version}/${id}-${artifact.platform}.zip`)) fail(`${id} has an artifact URL for the wrong release or platform bundle.`);
  }
  const tools = manifest.tools ?? [];
  for (const tool of tools) {
    if (!tool.id || !tool.version || !["macos","windows","linux"].includes(tool.platform) || !["aarch64","x86_64"].includes(tool.architecture)) fail(`${id} has an invalid tool variant.`);
    if (!tool.path || path.isAbsolute(tool.path) || tool.path.split(/[\\/]/).some((part) => !part || part === "." || part === "..")) fail(`${id} has an unsafe tool path.`);
  }
  if (tools.length && !(await stat(path.join(repo, `extensions/${id}/THIRD_PARTY_NOTICES.md`)).catch(() => null))) fail(`${id} must include third-party notices.`);
}

const sourceFiles = await sourceFilesBelow(path.join(repo, "src"));
const forbidden = /(?:text|bg|border)-(?:zinc|neutral|slate|gray)-|#(?:090c10|e4e4e7|adadad|eeeeee)\b/i;
for (const file of sourceFiles.filter((file) => /\.(?:tsx|css)$/.test(file) && !file.endsWith("ThemesPlugin.tsx") && !file.includes(`${path.sep}previewPanel${path.sep}`) && !file.includes(`${path.sep}vault${path.sep}`))) {
  const source = await readFile(file, "utf8");
  if (forbidden.test(source)) fail(`${path.relative(repo, file)} contains a hardcoded neutral instead of a semantic Misty token.`);
}

console.log(`Validated ${ids.size} extension catalog entries at v${packageJson.version}.`);

async function json(relative) {
  try { return JSON.parse(await readFile(path.join(repo, relative), "utf8")); }
  catch (error) { fail(`${relative} is not valid JSON: ${error.message}`); }
}
function fail(message) { throw new Error(message); }
async function sourceFilesBelow(directory) { const result=[]; for (const entry of await readdir(directory,{withFileTypes:true})) { const current=path.join(directory,entry.name); if(entry.isDirectory()) result.push(...await sourceFilesBelow(current)); else result.push(current); } return result; }
