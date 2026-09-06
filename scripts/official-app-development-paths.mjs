import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Older installed CLI versions still pass the repository's former name.
// Recover that rename and the known generated-assets path for embedded-only
// catalogs. Other explicit paths must not silently switch to a remote catalog.
export function officialAppDevelopmentPath(
  configured,
  cwd,
  relativePath,
  { allowMissingGeneratedAssets = false } = {},
) {
  const fallback = resolve(cwd, "../misty-apps", relativePath);
  if (!configured?.trim()) return fallback;
  const selected = resolve(configured.trim());
  if (existsSync(selected)) return selected;
  const legacy = resolve(cwd, "../misty-store", relativePath);
  const optionalAssets = allowMissingGeneratedAssets && relativePath === "public/official-apps";
  if (selected === fallback && optionalAssets) return fallback;
  if (selected === legacy && (existsSync(fallback) || optionalAssets)) {
    console.warn(`Misty Apps moved from ${selected} to ${fallback}. Update the Misty CLI.`);
    return fallback;
  }
  throw new Error(`Configured Misty App path does not exist: ${selected}`);
}

// Embedded apps ship with the Host; they have no development archives to serve.
// Empty/unknown catalogs remain conservative and require package assets.
export function officialAppCatalogRequiresAssets(catalogPath) {
  if (!existsSync(catalogPath)) return true;
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  return (
    !Array.isArray(catalog.apps) ||
    catalog.apps.length === 0 ||
    catalog.apps.some((app) =>
      [app.desktop, app.mobile].some(
        (platform) => !["embedded", "unsupported"].includes(platform?.runtime),
      ),
    )
  );
}
