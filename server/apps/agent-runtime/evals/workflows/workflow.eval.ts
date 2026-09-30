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
const device = process.env.MISTY_WORKFLOW_EVAL_DEVICE === "1";
const enabled = process.env.MISTY_WORKFLOW_EVAL === "1";

const selected = (task: WorkflowTask) => !only.size || only.has(task.id) || only.has(task.category) || only.has(task.source);

/** The request each agent.entry sends today. Schedules run as the composer until the eval can claim one. */
function request(task: WorkflowTask, model: string, agentId: string, siteBase: string): Record<string, unknown> {
  const base = { prompt: task.prompt, model_override: model, reasoning_effort: "low", window_label: "main", ...(agentId ? { agent_id: agentId } : {}) };
  if (task.surface === "cursor") {
    return { ...base, mode: "companion", surface_id: "global", companion_mode: "auto", ...(task.start?.screen ? { display_captures: [displayCapture(task.start.screen)] } : {}) };
  }
  const tab = task.start?.tab ? { current_tab: { title: task.start.tab.site, url: `${siteBase}/${task.start.tab.site}` } } : {};
  return { ...base, mode: "drawer", surface_id: "global", ...tab };
}

async function runTask(client: EvalClient, budget: Budget, task: WorkflowTask, model: string, agentId: string, siteBase: string): Promise<WorkflowRun> {
  const before = budget.balance;
  const started = performance.now();
  const result = await client.run(request(task, model, agentId, siteBase));
  const run: WorkflowRun = {
    taskId: task.id, category: task.category, source: task.source, surface: task.surface, model,
    terminal: result.terminal, tools: result.tools, screenRequests: result.screenRequests,
    answer: result.answer.slice(0, 4_000), ms: performance.now() - started, costUsd: 0,
    routing: routing(task, result.tools, result.screenRequests),
  };
  if (!/completed$/.test(result.terminal)) run.error = `run ended: ${result.terminal}`;
  // A run stopped at a screen hand-off has no answer to grade yet; its route still counts.
  const handedOff = result.screenRequests.length > 0 && !device;
  const textPassed = expectPassed(result.answer, task.expect);
  if (!handedOff && task.rubric?.length) {
    try {
      const verdict = await judge({
        model: judgeModel, subject: "a personal assistant agent", prompt: task.prompt, rubric: task.rubric,
        answer: result.answer, pageMarkdown: "", toolCalls: result.tools,
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
        const run = await runTask(client, budget, task, model, agentId, sites.base);
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
