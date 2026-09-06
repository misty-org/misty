/** Run against a built Inbox component. Device/server doubles; this is not a native macOS test.
 * Usage: MISTY_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/sdk-inbox-render-run.mjs <package-output> [artifacts-directory]
 */
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { build } from "esbuild";

if (!process.argv[2])
  throw new Error("Pass the directory containing the built Inbox app.js and app.css.");
const packageRoot = path.resolve(process.argv[2]);
const root = process.argv[3]
  ? path.resolve(process.argv[3])
  : await fs.mkdtemp(path.join(os.tmpdir(), "misty-inbox-render-"));
await fs.mkdir(root, { recursive: true });
for (const [source, target] of [
  [path.join(packageRoot, "app.js"), "inbox.js"],
  [path.join(packageRoot, "app.css"), "app.css"],
  [path.join(import.meta.dirname, "sdk-inbox-render-probe.html"), "index.html"],
])
  await fs.copyFile(source, path.join(root, target));
await build({
  entryPoints: [path.join(import.meta.dirname, "sdk-inbox-render-probe.ts")],
  bundle: true,
  format: "esm",
  define: { "process.env.NODE_ENV": '"production"' },
  outfile: path.join(root, "probe.js"),
});
const { chromium } = await import(process.env.MISTY_PLAYWRIGHT_MODULE || "playwright");
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, "http://local").pathname;
  try {
    if (!["/", "/index.html", "/probe.js", "/inbox.js", "/app.css"].includes(name))
      throw Error("Not found");
    res.setHeader(
      "Content-Type",
      name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html",
    );
    res.end(await fs.readFile(path.join(root, name === "/" ? "index.html" : name)));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  page.setDefaultTimeout(20000);
  const errors = [],
    network = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin && url.protocol !== "data:") {
      network.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  await page.addInitScript(() => {
    for (const name of ["read", "write", "readText", "writeText"])
      Object.defineProperty(navigator.clipboard, name, {
        value: () => {
          throw Error(`Browser clipboard bypass: ${name}`);
        },
      });
    window.showSaveFilePicker = () => {
      throw Error("Browser file save bypass");
    };
  });
  await page.goto(origin);
  await page.waitForFunction(() => window.inboxProbe);
  await page.getByText("Downloaded Inbox SDK", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(root, "inbox.png") });
  await page.getByText("Downloaded Inbox SDK", { exact: true }).click();
  await page.waitForFunction(() => inboxProbe.snapshot().surface);
  await page.locator('[data-inbox-message-view][data-state="open"]').waitFor();
  await page.waitForFunction(() => {
    const pane = document.querySelector('[data-inbox-message-view][data-state="open"]');
    return (
      pane &&
      Math.abs(
        pane.getBoundingClientRect().left - pane.parentElement.getBoundingClientRect().left,
      ) < 1
    );
  });
  await page.getByRole("button", { name: "Summarize with AI", exact: true }).click();
  await page.waitForFunction(() =>
    inboxProbe.calls.some((call) => call.method === "ai.action.run"),
  );
  await page.screenshot({ path: path.join(root, "message.png") });
  await page.getByRole("button", { name: "Attach file", exact: true }).click();
  await page.getByText("SDK attachment.txt", { exact: true }).waitFor();
  await page.waitForFunction(() =>
    inboxProbe.calls.some((call) => call.method === "files.release"),
  );
  await page.screenshot({ path: path.join(root, "attachment.png") });
  const methods = await page.evaluate(() => [
    ...new Set(inboxProbe.calls.map((call) => call.method)),
  ]);
  for (const method of [
    "ai.action.run",
    "mail.accounts.list",
    "mail.folders.list",
    "mail.threads.list",
    "mail.threads.get",
    "mail.cache.read",
    "mail.cache.write",
    "navigation.open",
    "files.pickMany",
    "files.readBytes",
    "files.release",
  ])
    assert.ok(methods.includes(method), `Missing actual Inbox UI method: ${method}`);
  errors.push(...(await page.evaluate(() => inboxProbe.errors)));
  await page.evaluate(() => inboxProbe.close());
  assert.equal((await page.evaluate(() => inboxProbe.snapshot())).surface, false);
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  const result = {
    status: "passed",
    environment: "headless Chromium with SDK device/server doubles",
    methods,
    errors,
    network,
    artifacts: root,
  };
  await fs.writeFile(path.join(root, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
