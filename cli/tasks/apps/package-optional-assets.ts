import {readFile, mkdir, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";

/** Copy compiler-declared immutable assets beside, never inside, the app ZIP. */
export async function packageOptionalAssets(directory, publicRoot, app) {
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(directory, "optional-assets.json"), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
  if (manifest.schemaVersion !== 1 || manifest.appId !== app.id ||
      JSON.stringify(manifest.origins) !== JSON.stringify(["https://apps.mistysys.com"]) ||
      !Array.isArray(manifest.assets) || !manifest.assets.length || manifest.assets.length > 512)
    throw new Error("Invalid optional app asset manifest.");
  for (const scope of ["network.fetch", "storage.read", "storage.write"])
    if (!app.scopes.includes(scope)) throw new Error(`Optional assets require the reviewed ${scope} permission.`);
  const seen = new Set();
  for (const asset of manifest.assets) {
    if (!/^[a-f0-9]{64}$/.test(asset.sha256) ||
        asset.key !== `official-app-assets/${app.id}/${asset.sha256}.woff2` || seen.has(asset.key))
      throw new Error("Invalid optional asset path or duplicate.");
    seen.add(asset.key);
    const bytes = await readFile(path.join(directory, asset.key));
    if (bytes.length !== asset.bytes || bytes.length > 128 * 1024 || bytes.subarray(0,4).toString() !== "wOF2" ||
        createHash("sha256").update(bytes).digest("hex") !== asset.sha256)
      throw new Error(`Optional app asset failed verification: ${asset.key}`);
    const target = path.join(publicRoot, asset.key);
    try {
      if (!(await readFile(target)).equals(bytes)) throw new Error("An immutable app asset already has different bytes.");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    await mkdir(path.dirname(target), {recursive:true});
    await writeFile(target, bytes);
  }
  const license = manifest.license;
  if (license?.key !== `official-app-assets/${app.id}/Xiaolai-OFL.txt`) throw new Error("Optional font license is missing.");
  const notice = await readFile(path.join(directory,license.key));
  if (notice.length !== license.bytes || createHash("sha256").update(notice).digest("hex") !== license.sha256)
    throw new Error("Optional font license failed verification.");
  await writeFile(path.join(publicRoot,license.key),notice);
  return manifest;
}
