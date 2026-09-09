/** Render the shipped review component with deterministic API doubles.
 * Browser layout evidence only; this does not claim native device validation.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
const root = process.cwd();
const temporary = await fs.mkdtemp(path.join(root, ".approval-preview-"));
const artifacts = process.argv[2] ?? "/tmp/misty-capability-approval-preview";
await fs.mkdir(artifacts, { recursive: true });
const id = "10000000-0000-4000-8000-000000000001";
const fixture = {
  approval: {
    id,
    run_id: "invocation_10000000-0000-4000-8000-000000000002",
    state: "pending",
    expires_at: "2099-01-01T00:00:00Z",
  },
  review: {
    execution: {
      requestId: id,
      runId: "10000000-0000-4000-8000-000000000002",
      effectId: id,
      capability: "habits.record",
      capabilityVersion: 1,
      providerId: "example.habits/backend",
      providerVersion: 1,
      targetId: id,
      targetRevision: 1,
      input: {
        habit: "Evening walk",
        note: "Walked by the water for 30 minutes. 健康 · مساء الخير",
        date: "2026-09-07",
      },
      deadline: "2099-01-01T00:00:00Z",
      grantIds: [],
    },
    target: {
      id,
      revision: 1,
      appId: "example.habits",
      providerId: "example.habits/backend",
      providerVersion: 1,
      label: "Personal habits — everyday activities and wellbeing",
      binding: { kind: "backend", connectionId: id },
    },
    effects: { kind: "write", incidental: [], approval: "scoped", retry: "reconcile" },
    description: "Record a habit",
  },
};
if (process.argv.includes("--browser")) {
  fixture.review = {
    kind: "browser",
    runId: fixture.approval.run_id,
    effectId: id,
    callId: "browser-fill",
    operation: "browser.interact",
    input: {
      scopeId: "personal-browser",
      documentId: id,
      action: {
        kind: "fill",
        elementRef: "message-field",
        text: "I can meet tomorrow at 10. 健康",
      },
    },
    target: {
      contextId: "attached-view",
      deviceId: "personal-mac",
      scopeId: "personal-browser",
      label: "Personal inbox",
      expiresAt: "2099-01-01T00:00:00Z",
    },
    pageUrl: "https://example.org/inbox/compose",
    pageTitle: "New message",
    elementLabel: "Message body",
    deadline: "2099-01-01T00:00:00Z",
  };
}
await fs.writeFile(
  path.join(temporary, "index.html"),
  '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>',
);
await fs.writeFile(
  path.join(temporary, "entry.tsx"),
  `
import React from 'react';import { createRoot } from 'react-dom/client';import { MemoryRouter } from 'react-router-dom';
import '/src/styles/styles.css';
import { CapabilityApprovals } from '/src/features/capability-approvals/CapabilityApprovals';
import { capabilityApprovalsApi } from '/src/features/capability-approvals/api';
import { useCapabilityApprovals } from '/src/features/capability-approvals/store';
const fixture=${JSON.stringify(fixture)};
capabilityApprovalsApi.review=async()=>fixture; capabilityApprovalsApi.decide=async()=>{};
capabilityApprovalsApi.list=async()=>({approvals:[]});
useCapabilityApprovals.setState({accountId:'fixture',loaded:true,items:[{...fixture.approval,tool_name:fixture.review.operation??'sdk.fixture',summary:fixture.review.kind==='browser'?'Review a browser action':'Allow habits.record on Personal habits?',created_at:'2026-09-07T00:00:00Z'}]});
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/activity?approval=${id}']}><main className="mx-auto max-w-3xl px-4 py-5"><h1 className="text-lg font-medium text-cream-bright">Activity</h1><CapabilityApprovals/></main></MemoryRouter>);
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
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`${error.name}: ${error.message} ${error.stack}`));
  const url = `http://127.0.0.1:${server.httpServer.address().port}/${path.basename(temporary)}/index.html`;
  for (const [name, width, height] of [
    ["desktop", 1100, 1000],
    ["mobile", 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(url);
    try {
      await page
        .getByRole("button", { name: "Approve this action", exact: true })
        .waitFor({ timeout: 10000 });
    } catch (error) {
      console.error(
        JSON.stringify({
          url,
          errors,
          body: (await page.locator("body").innerText()).slice(0, 1000),
        }),
      );
      throw error;
    }
    await page.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage: true });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    if (overflow) throw new Error(`${name} review overflows viewport`);
    const box = await page
      .getByRole("button", { name: "Approve this action", exact: true })
      .boundingBox();
    if (box.height < 44) throw new Error("Approval touch target is too small");
  }
  await page.getByRole("button", { name: "Approve this action", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "recheck permissions" }).waitFor();
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    JSON.stringify({
      artifacts,
      checked: [
        "desktop browser",
        "mobile browser",
        "overflow",
        "touch target",
        "approval confirmation",
      ],
    }),
  );
} finally {
  await browser?.close();
  await server?.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
