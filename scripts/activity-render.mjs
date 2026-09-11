/** Render the real Activity feed with deterministic data, without an account or backend. */
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
const root = process.cwd();
const temporary = await fs.mkdtemp(path.join(root, ".activity-preview-"));
const artifacts = "/tmp/misty-activity-preview";
await fs.mkdir(artifacts, { recursive: true });
await fs.writeFile(
  path.join(temporary, "index.html"),
  '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>',
);
await fs.writeFile(
  path.join(temporary, "entry.tsx"),
  `
import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
import '/src/styles/styles.css'; import {ActivityFeed} from '/src/features/activity/ActivityFeed';
import {ActivityMenu} from '/src/application/layouts/DesktopLayout/ActivityMenu';
import {ActivityPanel} from '/src/features/activity/ActivityPanel';
import {useActivityStore} from '/src/features/activity/useActivityStore';
const s=useActivityStore.getState(); s.setAccount('preview');
s.ingestLocal({id:'approval',kind:'failure',title:'Export needs your attention',body:'Choose a new destination to finish exporting the project.',appId:'journal',sourceLabel:'Journal',target:{kind:'route',href:'/apps/journal'},notify:false});
s.ingestLocal({id:'copy',kind:'completion',title:'Project files copied',body:'All 24 files are ready in the destination folder.',sourceLabel:'Files',appId:'files',target:{kind:'route',href:'/apps/files'},notify:false});
s.ingestLocal({id:'history',kind:'system',title:'Morgan updated the shared roadmap',body:'Design review moved to Friday.',sourceLabel:'Design studio',spaceId:'studio',notify:false});
createRoot(document.getElementById('root')).render(<MemoryRouter><main className="mx-auto flex h-screen max-w-3xl flex-col bg-charcoal-bg"><header className="flex items-center justify-between border-b border-charcoal-border px-4 py-3"><h1 className="text-lg text-cream-bright">Workspace</h1><ActivityMenu className="grid size-11 place-items-center text-cream-muted"/></header><p className="p-4 text-sm text-cream-muted">Your workspace stays open behind Activity.</p></main><ActivityPanel/></MemoryRouter>);
`,
);
let server, browser;
try {
  server = await createServer({
    root,
    mode: "web",
    server: { host: "127.0.0.1", port: 5198, strictPort: false },
    optimizeDeps: { entries: [path.join(temporary, "index.html")] },
    logLevel: "error",
  });
  await server.listen();
  const { chromium } = await import(
    process.env.MISTY_PLAYWRIGHT_MODULE || "../../misty-website/node_modules/playwright/index.mjs"
  );
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.MISTY_CHROMIUM_EXECUTABLE,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.stack);
  });
  for (const [name, width, height] of [
    ["desktop", 1100, 850],
    ["mobile", 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(
      "http://127.0.0.1:" +
        server.httpServer.address().port +
        "/" +
        path.basename(temporary) +
        "/index.html",
    );
    await page.getByRole("button", { name: "Activity, 2 needing attention", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.evaluate(async () => {
      await Promise.all(
        document.getAnimations().map((animation) => animation.finished.catch(() => {})),
      );
    });
    await page.getByRole("button", { name: "Mark all read", exact: true }).waitFor();
    await page.getByText("Morgan updated the shared roadmap", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(artifacts, name + "-activity.png"), fullPage: true });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw Error("Viewport overflow");
  }
  await page.getByRole("button", { name: "Filter activity", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "Completions", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('[role="menuitemcheckbox"][data-state="checked"]'),
  );
  await page.getByText("Export needs your attention", { exact: true }).waitFor({ state: "hidden" });
  await page.keyboard.press("Escape");
  await page.getByText("Project files copied", { exact: true }).waitFor();
  if (await page.getByText("Export needs your attention", { exact: true }).count())
    throw Error(
      "Filter did not hide request: " +
        (await page.locator('[role="dialog"]').getAttribute("data-state")) +
        " " +
        (await page.locator('[role="dialog"]').innerText()),
    );
  await page.getByRole("button", { name: "Mark filtered read", exact: true }).click();
  await page.getByRole("button", { name: "Search activity", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search activity text" }).fill("files copied");
  await page.screenshot({ path: path.join(artifacts, "mobile-filtered.png"), fullPage: true });
  await page.getByRole("searchbox").fill("no matching phrase");
  await page.getByText("No matching activity", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.getByRole("button", { name: "Filter activity", exact: true }).click();
  await page.getByRole("menuitem", { name: "Reset filters", exact: true }).click();
  await page.keyboard.press("Escape");
  await page
    .getByRole("navigation", { name: "Activity sections" })
    .getByRole("button", { name: /^Unread / })
    .click();
  if (await page.getByText("Project files copied", { exact: true }).count())
    throw Error("Read completion remains in Unread");
  await page.getByRole("button", { name: /^System / }).click();
  if ((await page.getByText("Morgan updated the shared roadmap", { exact: true }).count()) !== 1)
    throw Error("System missing update");
  await page.setViewportSize({ width: 1100, height: 850 });
  await page
    .getByRole("navigation", { name: "Activity sections" })
    .getByRole("button", { name: /^All / })
    .click();
  await page.getByRole("button", { name: "Sort activity", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Oldest first", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.getAttribute("title") === "Activity");
  await page
    .getByRole("button", { name: "Activity, 1 needing attention", exact: true })
    .press("Enter");
  await page.getByRole("dialog").waitFor();
  if (await page.getByRole("searchbox").count()) throw Error("Search did not reset on reopen");
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await page.getByText("Export needs your attention", { exact: true }).waitFor();
  if (await page.getByText("Project files copied", { exact: true }).count())
    throw Error("Clear kept completion");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    JSON.stringify({
      artifacts,
      checked: [
        "desktop",
        "mobile",
        "Unified feed",
        "Sections and filtered counts",
        "panel",
        "filters",
        "keyboard",
        "overflow",
      ],
    }),
  );
} finally {
  await browser?.close();
  await server?.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
