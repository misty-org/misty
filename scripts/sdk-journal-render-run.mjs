/** Run against a built Journal component. Device/server doubles; this is not a native macOS test.
 * Usage: MISTY_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/sdk-journal-render-run.mjs <package-output> [artifacts-directory]
 */
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { build } from "esbuild";

if (!process.argv[2]) throw new Error("Pass the directory containing the built Journal app.js and app.css.");
const packageRoot = path.resolve(process.argv[2]);
const root = process.argv[3] ? path.resolve(process.argv[3]) : await fs.mkdtemp(path.join(os.tmpdir(), "misty-journal-render-"));
await fs.mkdir(root, { recursive: true });
for (const [source, target] of [[path.join(packageRoot, "app.js"), "journal.js"], [path.join(packageRoot, "app.css"), "app.css"], [path.join(import.meta.dirname, "sdk-journal-render-probe.html"), "index.html"]])
  await fs.copyFile(source, path.join(root, target));
const require = createRequire(import.meta.url);
const yjsRequire = createRequire(require.resolve("yjs"));
await build({ entryPoints: [path.join(import.meta.dirname, "sdk-journal-render-probe.ts")], bundle: true, format: "esm", define: { "process.env.NODE_ENV": '"production"' }, alias: { lib0: path.dirname(yjsRequire.resolve("lib0/package.json")) }, outfile: path.join(root, "probe.js") });
const { chromium } = await import(process.env.MISTY_PLAYWRIGHT_MODULE || "playwright");
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, "http://local").pathname;
  try {
    if (!["/", "/index.html", "/probe.js", "/journal.js", "/app.css"].includes(name)) throw Error("Not found");
    res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html");
    res.end(await fs.readFile(path.join(root, name === "/" ? "index.html" : name)));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  page.setDefaultTimeout(20000);
  const errors = [], network = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin && url.protocol !== "data:") { network.push(url.href); return route.abort(); }
    return route.continue();
  });
  await page.addInitScript(() => {
    for (const name of ["read", "write", "readText", "writeText"])
      Object.defineProperty(navigator.clipboard, name, { value: () => { throw Error(`Browser clipboard bypass: ${name}`); } });
    window.showSaveFilePicker = () => { throw Error("Browser file save bypass"); };
  });
  await page.goto(origin);
  await page.waitForFunction(() => window.journalProbe);
  await page.locator(".excalidraw canvas").first().waitFor();
  await page.waitForFunction(() => journalProbe.snapshot().fonts >= 230);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(root, "canvas.png") });
  const opened = await page.evaluate(() => journalProbe.snapshot());
  assert.equal(opened.leases, 1); assert.equal(opened.surface, true); assert.equal(opened.elements, 2);

  await page.mouse.click(180, 160, { button: "right" });
  await page.getByRole("button", { name: /^Copy to clipboard as PNG/ }).click();
  await page.waitForFunction(() => journalProbe.calls.some(call => call.method === "clipboard.writeImage"));
  await page.mouse.click(600, 300, { button: "right" });
  await page.getByRole("button", { name: "Copy to clipboard as SVG", exact: true }).click();
  await page.waitForFunction(() => journalProbe.calls.some(call => call.method === "clipboard.writeText" && call.params?.text.includes("<svg")));
  await page.mouse.click(600, 300, { button: "right" });
  await page.getByText("Paste", { exact: true }).click();
  await page.waitForFunction(() => journalProbe.drawingElements().some(element => element.text === "SDK clipboard text"));

  await page.getByTestId("main-menu-trigger").click();
  await page.getByText("Save to...", { exact: true }).click();
  await page.getByRole("button", { name: "Save to file", exact: true }).click();
  await page.waitForFunction(() => journalProbe.outputs.some(file => file.name.endsWith(".excalidraw")));

  await page.evaluate(() => journalProbe.preview());
  await page.getByRole("button", { name: "Copy to clipboard", exact: true }).waitFor();
  await page.getByRole("button", { name: "Copy to clipboard", exact: true }).click();
  await page.waitForFunction(() => journalProbe.calls.filter(call => call.method === "clipboard.writeImage").length === 2);
  await page.screenshot({ path: path.join(root, "preview.png") });
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  await page.getByRole("menuitem", { name: "SVG", exact: true }).click();
  await page.waitForFunction(() => journalProbe.outputs.some(file => file.name.endsWith(".svg")));
  const exports = await page.evaluate(() => journalProbe.outputs);
  const methods = await page.evaluate(() => [...new Set(journalProbe.calls.map(call => call.method))]);
  errors.push(...await page.evaluate(() => journalProbe.errors));
  await page.evaluate(() => journalProbe.close());
  const closed = await page.evaluate(() => journalProbe.snapshot());
  assert.equal(closed.leases, 0); assert.equal(closed.subscriptions, 0); assert.equal(closed.surface, false);
  assert.deepEqual(errors, []); assert.deepEqual(network, []);
  for (const method of ["clipboard.readImage", "clipboard.readText", "clipboard.writeImage", "clipboard.writeText", "files.pickDirectory", "files.createCopy", "files.appendCopy", "files.commitCopy", "files.release"])
    assert.ok(methods.includes(method), `Missing actual UI SDK call: ${method}`);
  const result = { status: "passed", environment: "headless Chromium with SDK device/server doubles", opened, closed, exports, methods, errors, network, artifacts: root };
  await fs.writeFile(path.join(root, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
