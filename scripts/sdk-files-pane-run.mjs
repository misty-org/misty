/** Shared Files UI + real SDK/controller/PNG decoding; native replies are disposable fixtures. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer as reservePort } from "node:net";
import { createServer } from "vite";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const yjsRequire = createRequire(require.resolve("yjs"));
const artifacts = path.resolve(process.argv[2] || "/tmp/misty-sdk-files-pane-proof");
await fs.mkdir(artifacts, { recursive: true });
const reservation = reservePort();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const server = await createServer({
  mode: "desktop",
  optimizeDeps: { entries: ["scripts/sdk-files-pane-probe.html"] },
  resolve: { alias: { lib0: path.dirname(yjsRequire.resolve("lib0/package.json")) } },
  server: { watch: null, hmr: false, host: "127.0.0.1", port, strictPort: true },
});
let browser, page;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${port}`;
  const { chromium } = await import(process.env.MISTY_PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.MISTY_CHROMIUM_EXECUTABLE,
  });
  page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  page.setDefaultTimeout(15000);
  const errors = [],
    outside = [];
  page.on("pageerror", (error) => {
    errors.push(String(error));
    console.error(String(error));
  });
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (![origin, "null"].includes(url.origin)) {
      outside.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${origin}/scripts/sdk-files-pane-probe.html`);
  await page.waitForFunction(() => window.filesProbe);
  const row = (name) => page.locator("tr").filter({ hasText: name });
  await row("fixture.zip").dblclick();
  await page.getByText("inside.txt", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close preview", exact: true }).click();
  await row("日本語.txt").dblclick();
  await page.getByText("SDK-owned file", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Edit text", exact: true }).click();
  await page.getByRole("textbox").fill("Saved through the full preview\nsecond line\n");
  await page.getByRole("textbox").press("Meta+s");
  await page.waitForFunction(
    () =>
      filesProbe.snapshot().contents["日本語.txt"] ===
      "Saved through the full preview\r\nsecond line\r\n",
  );
  await page.getByRole("button", { name: "Edit text", exact: true }).click();
  await page.getByRole("textbox").fill("A separate copy\n");
  await page.getByRole("button", { name: "Save as Copy", exact: true }).click();
  await page.waitForFunction(
    () => filesProbe.snapshot().contents["日本語 1.txt"] === "A separate copy\r\n",
  );
  await page.screenshot({ path: path.join(artifacts, "sdk-files-preview-save.png") });
  await page.getByRole("button", { name: "Close preview", exact: true }).click();
  await page.getByLabel("Filter SDK Files").fill("日本語");
  await page.waitForFunction(
    () => !document.querySelector("tbody")?.textContent.includes("fixture.png"),
  );
  await page.getByLabel("Filter SDK Files").fill("");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "File", exact: true }).click();
  await page
    .getByRole("textbox", { name: "New item name", exact: true })
    .pressSequentially("new.txt");
  await page.getByRole("textbox", { name: "New item name", exact: true }).press("Enter");
  await row("new.txt").click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("textbox", { name: "Rename item", exact: true }).fill("renamed");
  await page.getByRole("textbox", { name: "Rename item", exact: true }).press("Enter");
  await row("renamed.txt").click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForFunction(() => !filesProbe.snapshot().names.includes("renamed.txt"));
  await row("日本語.txt").click();
  await row("日本語 1.txt").click({ modifiers: ["Meta"] });
  await row("日本語.txt").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByLabel("Prefix", { exact: true }).fill("renamed-");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.waitForFunction(
    () =>
      filesProbe.snapshot().names.includes("renamed-日本語.txt") &&
      filesProbe.snapshot().names.includes("renamed-日本語 1.txt"),
  );
  await page.getByRole("button", { name: "View as grid", exact: true }).click();
  await page.waitForFunction(() =>
    [...document.images].some(
      (image) =>
        image.src.startsWith("blob:") &&
        image.complete &&
        image.naturalWidth === 3 &&
        image.naturalHeight === 2,
    ),
  );
  await page.screenshot({ path: path.join(artifacts, "sdk-files-grid.png") });
  await page.evaluate(() => filesProbe.close());
  await page.waitForFunction(() => {
    const s = filesProbe.snapshot();
    return !s.handles && !s.watchers && !s.urls && !s.drafts;
  });
  const result = await page.evaluate(() => ({
    snapshot: filesProbe.snapshot(),
    calls: [...new Set(filesProbe.calls)],
    errors: filesProbe.errors,
  }));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(outside, []);
  for (const method of [
    "files.pickDirectory",
    "files.listDirectory",
    "files.readBytes",
    "files.listArchive",
    "files.replaceCopy",
    "files.commitCopy",
    "files.createEntry",
    "files.renameEntry",
    "files.removeEntry",
    "files.watchClose",
    "files.release",
  ])
    assert.ok(result.calls.includes(method), method);
  await fs.writeFile(
    path.join(artifacts, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        environment: "Chromium shared Files views and scoped SDK with device fixtures",
        ...result,
        outside,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ status: "passed", artifacts, ...result }));
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(artifacts, "failure.png") });
    await fs.writeFile(path.join(artifacts, "failure.html"), await page.content());
  }
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
