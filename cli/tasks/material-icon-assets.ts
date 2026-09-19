import { readFileSync, copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";

const packageRoot = dirname(
  createRequire(import.meta.url).resolve("material-icon-theme/package.json"),
);
const manifestPath = join(packageRoot, "dist/material-icons.json");

/** Keep every association consumed by FileBrowserIcons, without VS Code-only themes. */
export function compactMaterialIcons(theme) {
  const result = Object.fromEntries(
    [
      "file",
      "folder",
      "folderExpanded",
      "fileNames",
      "fileExtensions",
      "folderNames",
      "folderNamesExpanded",
    ]
      .filter((key) => theme[key] !== undefined)
      .map((key) => [key, theme[key]]),
  );
  const references = new Set(
    [
      result.file,
      result.folder,
      result.folderExpanded,
      ...["fileNames", "fileExtensions", "folderNames", "folderNamesExpanded"].flatMap((key) =>
        Object.values(result[key] ?? {}),
      ),
    ].filter(Boolean),
  );
  result.iconDefinitions = Object.fromEntries(
    [...references].map((id) => {
      const definition = theme.iconDefinitions[id];
      if (!definition?.iconPath) throw new Error(`Missing material icon: ${id}`);
      return [id, { iconPath: basename(definition.iconPath) }];
    }),
  );
  return result;
}

export function materialIconProjection() {
  return {
    name: "misty-material-icon-projection",
    enforce: "pre",
    load(id) {
      if (id !== manifestPath) return;
      this.addWatchFile(manifestPath);
      return JSON.stringify(compactMaterialIcons(JSON.parse(readFileSync(manifestPath, "utf8"))));
    },
  };
}

export function copyMaterialIcons(outputDirectory) {
  const theme = compactMaterialIcons(JSON.parse(readFileSync(manifestPath, "utf8")));
  const destination = resolve(outputDirectory);
  mkdirSync(destination, { recursive: true });
  for (const name of new Set(Object.values(theme.iconDefinitions).map((icon) => icon.iconPath))) {
    copyFileSync(join(packageRoot, "icons", name), join(destination, name));
  }
}

/** Package icons only when the application actually imports their associations. */
export function packageMaterialIcons() {
  return {
    name: "misty-package-material-icons",
    generateBundle(_options, bundle) {
      if (!Object.values(bundle).some(item => item.type === "chunk" &&
          Object.entries(item.modules).some(([id, details]) =>
            id.endsWith("/material-icon-theme/dist/material-icons.json") && details.renderedLength > 0))) return;
      const theme = compactMaterialIcons(JSON.parse(readFileSync(manifestPath, "utf8")));
      for (const name of new Set(Object.values(theme.iconDefinitions).map(icon => icon.iconPath)))
        this.emitFile({ type: "asset", fileName: `assets/material-icon-theme/${name}`,
          source: readFileSync(join(packageRoot, "icons", name)) });
    },
  };
}
