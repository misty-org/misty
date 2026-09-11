import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename } from "node:path";
import { compactMaterialIcons } from "./material-icon-assets.mjs";

const theme = JSON.parse(
  readFileSync(
    createRequire(import.meta.url).resolve("material-icon-theme/dist/material-icons.json"),
    "utf8",
  ),
);

test("every filename, extension and folder state keeps its original icon asset", () => {
  const compact = compactMaterialIcons(theme);
  for (const key of ["fileNames", "fileExtensions", "folderNames", "folderNamesExpanded"]) {
    assert.deepEqual(compact[key], theme[key]);
    for (const id of Object.values(theme[key])) {
      assert.equal(
        compact.iconDefinitions[id].iconPath,
        basename(theme.iconDefinitions[id].iconPath),
      );
    }
  }
  for (const key of ["file", "folder", "folderExpanded"]) {
    assert.equal(compact[key], theme[key]);
    assert.equal(
      compact.iconDefinitions[compact[key]].iconPath,
      basename(theme.iconDefinitions[theme[key]].iconPath),
    );
  }
  assert.ok(JSON.stringify(compact).length < JSON.stringify(theme).length);
});

test("invalid icon references fail the build instead of producing broken images", () => {
  assert.throws(
    () => compactMaterialIcons({ file: "missing", iconDefinitions: {} }),
    /Missing material icon/,
  );
});
