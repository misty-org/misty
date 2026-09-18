/** Exercise the real dock renderer with disposable iframe surfaces (no account needed). */
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createServer } from "vite";

const root = process.cwd();
const temporary = await fs.mkdtemp(path.join(root, ".pane-lifecycle-"));
const artifacts = path.resolve(process.argv[2] ?? "artifacts/pane-lifecycle");
await fs.mkdir(artifacts, { recursive: true });
await fs.writeFile(
  path.join(temporary, "index.html"),
  '<html><body style="margin:0"><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>',
);
await fs.writeFile(
  path.join(temporary, "entry.tsx"),
  `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import '/src/styles/styles.css';
import {WorkspaceDockTree} from '/src/application/layouts/DesktopLayout/WorkspaceDockTree';
import {createDockLeaf, insertDockSplit, useWorkspaceStore} from '/src/features/workspace';
const tab = id => ({id, surfaceId:'space', groupKey:'space:fixture:journal', instanceKey:id, title:id, route:'/spaces/fixture/notes', sidebarVisible:true, state:{}, createdAt:1, lastFocusedAt:1});
const a=createDockLeaf([tab('a'),tab('c')]), b=createDockLeaf([tab('b')]);
a.activeTabId='a';
const initial=insertDockSplit(a,a.id,b,'right');
function Preview(){
 const [node,setNode]=useState(initial);
 const apply = next => {useWorkspaceStore.setState({layout:{...useWorkspaceStore.getState().layout,root:next,focusedPaneId:a.id}});setNode(next)};
 const props={node,focusedPaneId:a.id,lastUsedTabByGroup:{},onOpen:()=>{},onClose:()=>{},onOpenNewTab:()=>{},onMoveTab:()=>true,onDockTab:()=>true,onSplitPane:()=>null,onClosePane:()=>{},virtualWindows:[],activeVirtualWindowId:'fixture',canReopenVirtualWindow:false,onSelectVirtualWindow:()=>{},onCreateVirtualWindow:()=>{},onCloseVirtualWindow:()=>{},onReopenVirtualWindow:()=>{},onResizeSplit:(id,ratio)=>setNode(current=>current.type==='split'&&current.id===id?{...current,ratio}:current)};
 return <><nav style={{height:40,display:'flex',gap:20}}>
 <button onClick={()=>apply({...initial,first:b,second:a})}>Swap</button>
 <button onClick={()=>apply(insertDockSplit(b,b.id,a,'down'))}>Move below</button>
 <button onClick={()=>apply(a)}>Collapse</button>
 <button onClick={()=>apply(initial)}>Split</button>
 <button onClick={()=>apply(insertDockSplit({...a,tabs:[...a.tabs].reverse()},a.id,b,'right'))}>Reorder tabs</button>
 </nav><main style={{height:'calc(100vh - 40px)'}}><WorkspaceDockTree {...props}/></main></>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
`,
);
let server, browser;
try {
  server = await createServer({
    root,
    mode: "web",
    logLevel: "error",
    server: { host: "127.0.0.1", port: 5191, strictPort: false },
    optimizeDeps: { entries: [path.join(temporary, "index.html")] },
    plugins: [
      {
        name: "pane-lifecycle-fixtures",
        enforce: "pre",
        async load(id) {
          if (id === path.join(root, "src/application/layouts/DesktopLayout/WorkspaceSurface.tsx"))
            return `import React from 'react'; export function WorkspaceSurface({tab,active}) {return <iframe title={tab.id} data-surface={tab.id} style={{width:'100%',height:'100%',border:0}} srcDoc={'<body style="background:#191919;color:#e0e0e0;font:20px system-ui"><h1>Browser '+tab.id+'</h1><input aria-label="Draft" placeholder="Keep this draft"><div style="height:1600px">Scroll stays here</div></body>'} onLoad={()=>{window.frameLoads??={};window.frameLoads[tab.id]=(window.frameLoads[tab.id]??0)+1;}}/>}`;
          if (id === path.join(root, "src/features/ai-surface/AiPaneHost.tsx"))
            return (
              (await fs.readFile(id, "utf8")).replace(
                "export function AiPaneHost(",
                "function FixtureOriginalAiPaneHost(",
              ) + "\nexport const AiPaneHost = ({children}) => children;"
            );
        },
      },
    ],
  });
  await server.listen();
  const { chromium } = await import(process.env.MISTY_PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.MISTY_CHROMIUM_EXECUTABLE,
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/${path.basename(temporary)}/index.html`,
  );
  await page.waitForFunction(
    () => window.frameLoads?.a === 1 && window.frameLoads?.b === 1 && window.frameLoads?.c === 1,
  );
  const frame = page.frameLocator('[data-surface="a"]');
  await frame.getByRole("textbox", { name: "Draft" }).fill("Keep this draft");
  await page.locator('[data-surface="a"]').evaluate((el) => el.contentWindow.scrollTo(0, 100));
  const alignment = async () => {
    await page.waitForFunction(() =>
      [...document.querySelectorAll("[data-pane-layout-slot]")].every((slot) => {
        const content = [...document.querySelectorAll("[data-pane-layout-content]")].find(
          (el) => el.dataset.paneLayoutContent === slot.dataset.paneLayoutSlot,
        );
        if (!content) return false;
        const a = slot.getBoundingClientRect(),
          b = content.getBoundingClientRect();
        return (
          ["x", "y", "width", "height"].every((key) => Math.abs(a[key] - b[key]) < 1) &&
          b.width > 0 &&
          b.height > 0
        );
      }),
    );
  };
  for (const action of ["Swap", "Move below", "Collapse", "Split", "Reorder tabs"]) {
    await page.getByRole("button", { name: action, exact: true }).click();
    await alignment();
    assert.equal(
      await frame.getByRole("textbox", { name: "Draft" }).inputValue(),
      "Keep this draft",
      action,
    );
    assert.equal(await page.evaluate(() => window.frameLoads.a), 1, action);
    assert.equal(
      await page.locator('[data-surface="a"]').evaluate((el) => el.contentWindow.scrollY),
      100,
      action,
    );
  }
  // Resize the actual react-resizable-panels handle, then check narrow and zoomed layouts.
  const handle = page.getByRole("separator", { name: "Resize panes horizontally" });
  const rect = await handle.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + 100);
  await page.mouse.down();
  await page.mouse.move(800, rect.y + 100, { steps: 8 });
  await page.mouse.up();
  await alignment();
  const resized = await handle.boundingBox();
  assert.ok(resized.x > rect.x + 100, "Splitter must track the pointer across embedded pages");
  await page.screenshot({ path: path.join(artifacts, "desktop.png") });
  await page.setViewportSize({ width: 820, height: 700 });
  await page.evaluate(() => (document.body.style.zoom = "1.25"));
  await alignment();
  await page.screenshot({ path: path.join(artifacts, "narrow-zoom.png") });
  assert.equal(await page.evaluate(() => window.frameLoads.a), 1);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      result: "passed",
      browserALoads: await page.evaluate(() => window.frameLoads.a),
      actions: ["swap", "move", "collapse", "split", "reorder", "resize", "zoom"],
      artifacts,
    }),
  );
} finally {
  await browser?.close();
  await server?.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
