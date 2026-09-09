import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  officialAppDevelopmentPath,
  officialAppCatalogRequiresAssets,
} from "./official-app-development-paths.mjs";

test("recovers old launcher paths and rejects other missing configured paths", () => {
  const root = mkdtempSync(join(tmpdir(), "misty-app-paths-"));
  try {
    const cwd = join(root, "misty");
    for (const relative of ["public/official-apps", "apps"]) {
      mkdirSync(join(root, "misty-apps", relative), { recursive: true });
    }
    writeFileSync(join(root, "misty-apps/apps/catalog.json"), "{}");
    for (const relative of ["public/official-apps", "apps/catalog.json"]) {
      const expected = join(root, "misty-apps", relative);
      assert.equal(officialAppDevelopmentPath(undefined, cwd, relative), expected);
      assert.equal(officialAppDevelopmentPath(expected, cwd, relative), expected);
      assert.equal(
        officialAppDevelopmentPath(join(root, "misty-store", relative), cwd, relative),
        expected,
      );
      assert.throws(
        () => officialAppDevelopmentPath(join(root, "missing", relative), cwd, relative),
        /Configured Misty App path does not exist/,
      );
    }
    const custom = join(root, "custom");
    mkdirSync(custom);
    assert.equal(officialAppDevelopmentPath(custom, cwd, "public/official-apps"), custom);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("embedded catalogs work without generated packages but still reject misspelled overrides", () => {
  const root = mkdtempSync(join(tmpdir(), "misty-embedded-paths-"));
  try {
    const cwd = join(root, "misty");
    const appsRoot = join(root, "misty-apps");
    const catalog = join(appsRoot, "apps/catalog.json");
    const assets = join(appsRoot, "public/official-apps");
    mkdirSync(join(appsRoot, "apps"), { recursive: true });
    for (const runtime of ["embedded", "unsupported", "downloaded", "hosted", "unknown"]) {
      writeFileSync(
        catalog,
        JSON.stringify({ apps: [{ desktop: { runtime }, mobile: { runtime: "embedded" } }] }),
      );
      const required = officialAppCatalogRequiresAssets(catalog);
      assert.equal(required, !["embedded", "unsupported"].includes(runtime));
      const options = { allowMissingGeneratedAssets: !required };
      if (required) {
        assert.throws(
          () => officialAppDevelopmentPath(assets, cwd, "public/official-apps", options),
          /does not exist/,
        );
      } else {
        assert.equal(
          officialAppDevelopmentPath(assets, cwd, "public/official-apps", options),
          assets,
        );
        assert.equal(
          officialAppDevelopmentPath(
            join(root, "misty-store/public/official-apps"),
            cwd,
            "public/official-apps",
            options,
          ),
          assets,
        );
      }
      assert.throws(
        () => officialAppDevelopmentPath(join(root, "typo"), cwd, "public/official-apps", options),
        /does not exist/,
      );
    }
    writeFileSync(catalog, JSON.stringify({ apps: [] }));
    assert.equal(officialAppCatalogRequiresAssets(catalog), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
