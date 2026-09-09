/** Render the shipped integration directories with disposable local SDK data.
 * Captures browser layout, not native WebKit or authenticated provider sessions.
 */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { appSourceRoot } from "./app-source-paths.mjs";
const root = process.cwd();
const temporary = await fs.mkdtemp(path.join(root, ".integration-preview-"));
const artifacts = path.resolve(process.argv[2] ?? "artifacts/integration-panels");
const shared = `${appSourceRoot(root)}/apps/shared`;
await fs.mkdir(artifacts, { recursive: true });
await fs.writeFile(
  path.join(temporary, "index.html"),
  '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>',
);
await fs.writeFile(
  path.join(temporary, "entry.tsx"),
  `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import '/src/styles/styles.css';
import {PlatformPanel} from '${shared}/PlatformPanel';
import {ProviderDirectory} from '${shared}/ProviderDirectory';
import {WebsiteDirectory} from '${shared}/WebsiteDirectory';
import {ConnectedStoragePanel} from '/src/features/providers/components/ConnectedStoragePanel';
import {useProvidersStore} from '/src/features/providers/store';
const params = new URLSearchParams(location.search), app = params.get('app') || 'library';
const embedded = params.get('mode') !== 'page';
const names = {chat:'Social', inbox:'Inbox', planner:'Planner', journal:'Journal', library:'Library', files:'Connected storage'};
const rows = new Map();
const misty = {storage:{local:{keys:async()=>[...rows.keys()], get:async(key)=>rows.get(key)??null, set:async(key,value)=>{rows.set(key,value)}, delete:async(key)=>{rows.delete(key)}}} ,server:{call:async()=>({accounts:[]})},workspace:{setTitle:async()=>{}},navigation:{open:async(route)=>{document.body.dataset.destination=route}}};
useProvidersStore.setState({loading:false,working:false,error:'',load:async()=>{},providers:{remotes:[],workflows:[{type:'drive',name:'Google Drive',options:[]},{type:'dropbox',name:'Dropbox',options:[]},{type:'onedrive',name:'OneDrive',options:[]}],health:{}}});
function Preview(){const [open,setOpen]=useState(true); const directory=app==='chat'||app==='inbox'?<ProviderDirectory appId={app} misty={misty} embedded={embedded}/>:<WebsiteDirectory appId={app} misty={misty} embedded={embedded}/>;
return <main style={{height:'100dvh'}}>{embedded?<><button onClick={()=>setOpen(true)}>Open integrations</button>{app==='files'?(open&&<ConnectedStoragePanel onClose={()=>setOpen(false)}/>):<PlatformPanel open={open} title={names[app]} onClose={()=>setOpen(false)}>{directory}</PlatformPanel>}</>:directory}</main>}
createRoot(document.getElementById('root')).render(<Preview/>);
`,
);
let server, browser;
try {
  server = await createServer({
    root,
    mode: "web",
    server: { host: "127.0.0.1", port: 5187, strictPort: false },
    optimizeDeps: { entries: [path.join(temporary, "index.html")] },
    logLevel: "error",
  });
  await server.listen();
  const { chromium } = await import(process.env.MISTY_PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.MISTY_CHROMIUM_EXECUTABLE,
  });
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const errors = [],
    results = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const url = `http://127.0.0.1:${server.httpServer.address().port}/${path.basename(temporary)}/index.html`;
  for (const [size, width, height] of [
    ["desktop", 1280, 900],
    ["narrow", 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    for (const app of ["chat", "inbox", "planner", "journal", "library", "files"]) {
      await page.goto(`${url}?app=${app}`);
      await page.locator(".platform-entry").first().waitFor();
      await page.screenshot({
        path: path.join(artifacts, `${app}-${size}.png`),
        animations: "disabled",
      });
      const layout = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]'),
          entry = document.querySelector(".platform-entry"),
          copy = entry.querySelector(".provider-integration-copy"),
          action = document.querySelector(".platform-action");
        const rect = dialog.getBoundingClientRect();
        return {
          display: getComputedStyle(entry).display,
          border: getComputedStyle(entry).borderWidth,
          font: getComputedStyle(copy.querySelector("strong")).fontSize,
          overflow: dialog.scrollWidth > dialog.clientWidth,
          inside:
            rect.left >= 0 &&
            rect.right <= innerWidth &&
            rect.top >= 0 &&
            rect.bottom <= innerHeight,
          aligned: entry.getBoundingClientRect().right <= action.getBoundingClientRect().left,
        };
      });
      assert.equal(layout.display, "flex");
      assert.equal(layout.border, "0px");
      assert.equal(layout.font, "14px");
      assert.equal(layout.overflow, false);
      assert.equal(layout.inside, true);
      assert.equal(layout.aligned, true);
      results.push({ app, size, ...layout });
      const search = page.getByRole("textbox", { name: /Search/ });
      await search.fill("no-such-provider-fixture");
      await page.getByRole("status").filter({ hasText: "No matches" }).waitFor();
      await search.fill("");
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Open integrations", exact: true }).click();
      await page.getByRole("dialog").waitFor();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      assert.equal(
        await page
          .getByRole("button", { name: "Open integrations", exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
    }
    await page.goto(`${url}?app=library&mode=page`);
    await page.locator(".platform-entry").first().waitFor();
    await page.screenshot({
      path: path.join(artifacts, `library-page-${size}.png`),
      animations: "disabled",
    });
    assert.equal(
      await page
        .locator(".platform-entry")
        .first()
        .evaluate((el) => getComputedStyle(el).display),
      "flex",
    );
    assert.equal(
      await page.locator(".provider-directory").evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
    );
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(artifacts, "results.json"),
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(
    `Verified ${results.length} popup layouts, both Library page widths, search, dismissal and return focus. Screenshots: ${artifacts}`,
  );
} finally {
  await browser?.close();
  await server?.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
