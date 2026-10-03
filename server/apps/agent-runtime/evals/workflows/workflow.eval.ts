// The workflow eval (docs/plans/agent-harness.md, phase 0). Each task is one
// real request through the whole harness on a local stack: the server's own
// system prompt, catalog, routing and screen hand-offs. It scores the answer
// and the route, and stops before the AI Gateway spend passes the budget.
//
//   MISTY_ACCEPTANCE_API=http://127.0.0.1:8081 npm run eval:workflows
//
// See README.md for the stack, accounts, filters and the report.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { judge } from "../browser/judge.js";
import { serveSites } from "../browser/tasks.js";
import { Budget } from "./budget.js";
import { EvalClient } from "./client.js";
import { expectPassed, passed, report, routing, type WorkflowRun } from "./score.js";
import { displayCapture, loadTasks, skipReason, type WorkflowTask } from "./tasks.js";

const here = resolve(import.meta.dirname);
const list = (value: string | undefined) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
// The cheapest current model of each provider's line.
const models = list(process.env.MISTY_WORKFLOW_EVAL_MODELS || "anthropic/claude-haiku-5.5,openai/gpt-6-luna,google/gemini-3.5-flash-lite");
const judgeModel = process.env.MISTY_WORKFLOW_EVAL_JUDGE?.trim() || "anthropic/claude-haiku-5.5";
const only = new Set(list(process.env.MISTY_WORKFLOW_EVAL_TASKS));
const accounts = new Set(list(process.env.MISTY_WORKFLOW_EVAL_ACCOUNTS));
// The person's own computer, by its agent-device id (trusted_devices.id): runs carry the
// workspace context a chat sent from it carries, signed by it through the debug build's
// eval bridge, so device tools such as web.fetch run on it as they would for a real request.
const deviceId = process.env.MISTY_WORKFLOW_EVAL_DEVICE?.trim() || "";
const device = /^device_[0-9a-f-]{36}$/.test(deviceId);
const workspaceCapabilities = ["bookmark.add", "bookmark.list", "browser.tab.list", "browser.tab.open", "web.fetch"];

async function deviceContexts(userId: string, agentId: string): Promise<unknown[]> {
  if (!device) return [];
  const bridge = process.env.MISTY_BROWSER_EVAL_BRIDGE?.replace(/\/$/, "");
  const token = process.env.MISTY_BROWSER_EVAL_BRIDGE_TOKEN;
  if (!bridge || !token) throw new Error("A device needs the desktop's eval bridge: set MISTY_BROWSER_EVAL_BRIDGE and its token.");
  const scope = `workspace:${deviceId}`;
  const response = await fetch(`${bridge}/run-grants`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      apiBase: `${process.env.MISTY_ACCEPTANCE_API ?? "http://127.0.0.1:8081"}/v1`.replace(/\/v1\/v1$/, "/v1"), accountId: userId,
      grants: [{ targetDeviceId: deviceId, agentId, capabilities: workspaceCapabilities, scopes: [scope] }],
    }),
  });
  const signed = (await response.json()) as { ok: boolean; result?: unknown[]; error?: string };
  if (!signed.ok || !signed.result?.[0]) throw new Error(`run grant: ${signed.error ?? response.status}`);
  return [{ device_id: deviceId, kind: "workspace", opaque_ref: scope, display_name: "Misty browser",
    capabilities: workspaceCapabilities, metadata: { source: "desktop" }, run_grant: signed.result[0] }];
}

const enabled = process.env.MISTY_WORKFLOW_EVAL === "1";

const selected = (task: WorkflowTask) => !only.size || only.has(task.id) || only.has(task.category) || only.has(task.source);

/** The request each agent.entry sends today. Schedules run as the composer until the eval can claim one. */
function request(task: WorkflowTask, model: string, agentId: string, siteBase: string, contexts: unknown[]): Record<string, unknown> {
  const base = {
    prompt: task.prompt, model_override: model, reasoning_effort: "low", window_label: "main",
    ...(agentId ? { agent_id: agentId } : {}), ...(contexts.length ? { device_contexts: contexts } : {}),
  };
  if (task.surface === "cursor") {
    return { ...base, mode: "companion", surface_id: "global", companion_mode: "auto", ...(task.start?.screen ? { display_captures: [displayCapture(task.start.screen)] } : {}) };
  }
  const tab = task.start?.tab ? { current_tab: { title: task.start.tab.site, url: `${siteBase}/${task.start.tab.site}` } } : {};
  return { ...base, mode: "drawer", surface_id: "global", ...tab };
}

async function runTask(client: EvalClient, budget: Budget, task: WorkflowTask, model: string, agentId: string, siteBase: string, contexts: unknown[]): Promise<WorkflowRun> {
  const before = budget.balance;
  const started = performance.now();
  const result = await client.run(request(task, model, agentId, siteBase, contexts));
  const run: WorkflowRun = {
    taskId: task.id, category: task.category, source: task.source, surface: task.surface, model,
    terminal: result.terminal, tools: result.tools, screenRequests: result.screenRequests,
    answer: result.answer.slice(0, 4_000), ms: performance.now() - started, costUsd: 0,
    routing: routing(task, result.tools, result.screenRequests),
  };
  // A run that ended incomplete but answered is graded on its answer; only a
  // run with nothing to show is an error.
  if (!/completed$/.test(result.terminal) && !result.answer.trim()) run.error = `run ended: ${result.terminal}`;
  // A run stopped at a screen hand-off has no answer to grade yet; its route still counts.
  const handedOff = result.screenRequests.length > 0 && !device;
  const textPassed = expectPassed(result.answer, task.expect);
  if (!handedOff && task.rubric?.length) {
    try {
      const verdict = await judge({
        model: judgeModel, prompt: task.prompt, rubric: task.rubric,
        subject: "a personal assistant agent. Its web_search and web_fetch tools read the web in the background: they never open a browser or touch the person's screen. Only screen_open, screen_look, browser_* and desktop tools do",
        answer: result.answer, pageMarkdown: "", toolCalls: result.tools, pagesRead: result.pagesRead,
        // The judge sees the screen the agent saw, so claims about it can be checked.
        ...(task.start?.screen ? { screenshot: { data: displayCapture(task.start.screen).data_url.split(",")[1] ?? "", mediaType: "image/png" } } : {}),
      });
      run.answerPassed = verdict.passed && textPassed !== false;
      run.judgeReasons = verdict.criteria.map((item) => `${item.met ? "✓" : "✗"} ${item.criterion}: ${item.reason}`);
    } catch (error) {
      run.error = `judge: ${String(error).slice(0, 200)}`;
    }
  } else if (!handedOff && textPassed !== undefined) {
    run.answerPassed = textPassed;
  }
  run.costUsd = Number((await budget.since(before)).toFixed(4));
  return run;
}

it.skipIf(!enabled)("runs workflow tasks within budget", async () => {
  const budget = await Budget.open();
  const client = await EvalClient.open();
  const agents = await client.json<{ agents: Array<{ id: string }> }>("/misty/agents");
  const agentId = agents.agents[0]?.id ?? "";
  const me = await client.json<{ id: string }>("/me");
  // Signed once per pass; a run grant lasts six hours.
  const contexts = await deviceContexts(me.id, agentId);
  const tasks = loadTasks().filter(selected);
  const sites = await serveSites();
  const runs: WorkflowRun[] = [];
  const skipped: Record<string, string> = {};
  let stopped = "";
  // Runs refused before the model ever ran (an account limit or a broken stack) say nothing about the agent.
  let refusedInARow = 0;
  try {
    outer: for (const model of models) {
      for (const task of tasks) {
        const reason = skipReason(task, accounts, device);
        if (reason) {
          skipped[task.id] = reason;
          continue;
        }
        if (!(await budget.allows())) {
          stopped = `budget: $${budget.spent.toFixed(2)} of $${budget.cap.toFixed(2)} spent`;
          break outer;
        }
        const run = await runTask(client, budget, task, model, agentId, sites.base, contexts);
        runs.push(run);
        refusedInARow = run.error && run.tools.length === 0 && run.ms < 3_000 ? refusedInARow + 1 : 0;
        if (refusedInARow >= 3) {
          stopped = "three runs in a row failed before the model ran: check the eval account's plan and the stack's logs";
          break outer;
        }
        const verdict = passed(run) ? "PASS" : run.routing.passed ? "FAIL answer" : "FAIL route";
        process.stderr.write(`${verdict} ${model} ${task.id} ${(run.ms / 1000).toFixed(1)}s ${run.tools.length} tools ${run.routing.runs} runs $${run.costUsd.toFixed(3)}${run.routing.broken.length ? ` — ${run.routing.broken.join("; ")}` : ""}${run.error ? ` — ${run.error}` : ""}\n`);
      }
    }
  } finally {
    await sites.close();
  }
  const dir = join(here, "reports");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ models, judgeModel, spentUsd: Number(budget.spent.toFixed(4)), balanceUsd: budget.balance, stopped, summary: report(runs), skipped, runs }, null, 2));
  process.stderr.write(`\nSpent $${budget.spent.toFixed(2)} (balance $${budget.balance.toFixed(2)})${stopped ? ` — stopped, ${stopped}` : ""}\nReport: ${file}\n`);
  expect(runs.length + Object.keys(skipped).length).toBeGreaterThan(0);
});
