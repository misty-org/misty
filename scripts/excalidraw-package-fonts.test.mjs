import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { excalidrawPackageFonts } from "./excalidraw-package-fonts.mjs";

const root = resolve(import.meta.dirname, "../node_modules/@excalidraw/excalidraw/dist/prod");
const uri = "./fonts/Cascadia/CascadiaCode-Regular.woff2";
test("packages real font bytes and decodes SVG export fonts without network access", async () => {
  const plugin = excalidrawPackageFonts();
  const input = `export class Font { getContent(points) { throw new Error('worker must not run'); } fetchFont(url) { throw new Error('network must not run'); } } export const uri = ${JSON.stringify(uri)};`;
  const output = await plugin.transform(input, `${root}/test.js`);
  const loaded = await import(`data:text/javascript;base64,${Buffer.from(output.code).toString("base64")}`);
  assert.ok(loaded.uri.startsWith("data:font/woff2;base64,"));
  assert.deepEqual(Buffer.from(await new loaded.Font().fetchFont(loaded.uri)), await readFile(resolve(root, uri)));
  const font = new loaded.Font(); font.urls = [loaded.uri];
  assert.equal(await font.getContent([65,66]), loaded.uri);
  await assert.rejects(new loaded.Font().fetchFont("https://cdn.example/font.woff2"), /not in the downloaded/);
  plugin.generateBundle.call({ error(message) { throw new Error(message); } });
});
test("fails a dependency upgrade that removes the expected font loader", async () => {
  const plugin = excalidrawPackageFonts();
  await assert.rejects(plugin.transform(`export const uri = ${JSON.stringify(uri)};`, `${root}/test.js`), /loader changed/);
});
