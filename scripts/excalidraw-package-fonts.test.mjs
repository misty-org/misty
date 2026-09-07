import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { excalidrawPackageFonts } from "./excalidraw-package-fonts.mjs";
const root = resolve(import.meta.dirname, "../node_modules/@excalidraw/excalidraw/dist/dev");
test("adapts real Excalidraw rendering/export and emits verified CJK shards outside the bundle", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "misty-fonts-"));
  try {
    const plugin = excalidrawPackageFonts({ assetDirectory: directory });
    let changed = 0;
    for (const file of await readdir(root)) {
      if (!file.endsWith(".js")) continue;
      const output = await plugin.transform(
        await readFile(resolve(root, file), "utf8"),
        resolve(root, file),
      );
      if (!output) continue;
      changed++;
      assert.equal([...output.code.matchAll(/data:font\/woff2;base64,/g)].length, 21);
      assert.equal(
        [
          ...output.code.matchAll(
            /https:\/\/apps.mistysys.com\/official-app-assets\/journal\/[a-f0-9]{64}\.woff2/g,
          ),
        ].length,
        209,
      );
      assert.match(output.code, /MistyDrawingFonts.prepare/);
      assert.match(output.code, /!MistyDrawingFonts.isPending\(fontFace\)/);
      assert.match(output.code, /MistyDrawingFonts.content/);
      assert.match(output.code, /catch \(error\) \{ throw error; \}/);
      assert.doesNotMatch(output.code, /await fetch\(url,/);
    }
    assert.equal(changed, 1);
    await plugin.generateBundle.call({
      error(message) {
        throw Error(message);
      },
      emitFile() {},
    });
    await plugin.writeBundle();
    const manifest = JSON.parse(await readFile(resolve(directory, "optional-assets.json"), "utf8"));
    assert.equal(manifest.assets.length, 209);
    for (const asset of manifest.assets) {
      const bytes = await readFile(resolve(directory, asset.key));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
      assert.ok(bytes.length <= 128 * 1024);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("fails a dependency upgrade that removes the expected font loader", async () => {
  const plugin = excalidrawPackageFonts();
  await assert.rejects(
    plugin.transform(
      'export const uri = "./fonts/Cascadia/CascadiaCode-Regular.woff2";',
      `${root}/test.js`,
    ),
    /loader changed/,
  );
});
