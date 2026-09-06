import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { excalidrawSdkInterop } from "./excalidraw-sdk-interop.mjs";

test("redirects every expected clipboard and file action in the installed drawing library", async () => {
  const root = resolve(import.meta.dirname, "../node_modules/@excalidraw/excalidraw/dist/dev");
  const plugin = excalidrawSdkInterop();
  let found = false;
  for (const filename of await readdir(root)) {
    if (!filename.endsWith(".js")) continue;
    const id = `${root}/${filename}`, code = await readFile(id, "utf8");
    const result = plugin.transform(code, id);
    if (!result) continue;
    found = true;
    for (const method of ["readSystemClipboard", "copyTextToSystemClipboard", "copyBlobToClipboardAsPng", "fileOpen", "fileSave"])
      assert.ok(result.code.includes(`var ${method} = MistyDrawingInterop.${method}`));
    assert.ok(result.code.includes("var probablySupportsClipboardBlob = true"));
    assert.ok(!result.code.includes("await navigator.clipboard.writeText(text"));
    assert.ok(!result.code.includes("await navigator.clipboard?.read()"));
  }
  assert.ok(found);
  plugin.generateBundle.call({ error(message) { throw new Error(message); } });
});
test("fails closed when the expected vendor actions change", () => {
  const plugin = excalidrawSdkInterop();
  assert.throws(() => plugin.transform("var readSystemClipboard = () => {};", "/repo/node_modules/@excalidraw/excalidraw/dist/dev/chunk.js"), /actions changed/);
});
