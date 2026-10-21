// The Odysseys benchmark through Misty's product path (docs/plans/odysseys-campaign.md):
// each task is a composer request on the local stack, with this computer as the device,
// so the agent searches, fetches and opens its own browser tab as it would for a person.
// The recorder pictures the agent's tabs as it goes; Odysseys' per-rubric judge grades.
// Batches stop early when failures pile up, so fixes come before more spending.
//
//   MISTY_ODYSSEYS=1 npm run eval:odysseys          (see README.md for the setup)
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { EvalClient } from "../workflows/client.js";
import { device, deviceContexts } from "../workflows/device.js";
import { runUsage } from "../workflows/usage.js";
import { judgeTask } from "./judge.js";
import { Recorder } from "./recorder.js";
import { leakedProcesses, pageProcesses } from "./leak-check.js";
import { Ledger, searchesUsd, tokenUsd } from "./spend.js";
import { loadTasks, selectTasks, type OdysseysTask } from "./tasks.js";

const env = (name: string, fallback = "") => process.env[name]?.trim() || fallback;
const list = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const model = env("MISTY_ODYSSEYS_MODEL", "anthropic/claude-haiku-5.5");
const effort = env("MISTY_ODYSSEYS_EFFORT", "low");
// Model turns per task: Ultra+'s 90 by default, near the paper's 100-step budget.
const turns = Number(env("MISTY_ODYSSEYS_TURNS", "90"));
const judgeModel = env("MISTY_ODYSSEYS_JUDGE", "anthropic/claude-haiku-5.5");
const split = env("MISTY_ODYSSEYS_SPLIT", "dev");
const limit = Number(env("MISTY_ODYSSEYS_LIMIT", "10"));
const offset = Number(env("MISTY_ODYSSEYS_OFFSET", "0"));
const earlyStop = env("MISTY_ODYSSEYS_EARLY_STOP", "1") === "1";
// How long a task should take is the agent's own estimate (its checklist), which its time
// budget enforces; each result shows estimate against time. This cap is only the safety net
// for a run that never stops. Past it the run is cancelled and the pass stops, so what it
// looped on is found and fixed first.
const taskMs = Number(env("MISTY_ODYSSEYS_TASK_MINUTES", "60")) * 60_000;
const parallel = Number(env("MISTY_ODYSSEYS_PARALLEL", "3"));
const here = resolve(import.meta.dirname);
const ledger = new Ledger(
  join(here, "reports", "ledger.json"),
  Number(env("MISTY_ODYSSEYS_CAP", "50")),
);
const bridgeUrl = env("MISTY_BROWSER_EVAL_BRIDGE").replace(/\/$/, "");
const bridge = bridgeUrl
  ? { url: bridgeUrl, token: env("MISTY_BROWSER_EVAL_BRIDGE_TOKEN") }
  : undefined;

export interface OdysseysRun {
  taskId: string;
  level: string;
  split: string;
  referenceLength: number;
  terminal: string;
  perfect: boolean;
  average: number;
  failed: Array<{ id: string; reasoning: string }>;
  tools: string[];
  turns: number;
  seconds: number;
  /** The agent's own estimate of the task's minutes, from its checklist; 0 when it gave none. */
  estimateMinutes: number;
  costUsd: number;
  answer: string;
  dir: string;
}

interface Performed {
  task: OdysseysTask;
  dir: string;
  recorder: Recorder;
  result: Awaited<ReturnType<EvalClient["run"]>>;
  seconds: number;
}

/** Runs one task through the product path and records it; grading comes later. */
async function perform(
  client: EvalClient,
  task: OdysseysTask,
  agentId: string,
  userId: string,
  dir: string,
): Promise<Performed> {
  const recorder = new Recorder(dir, bridge);
  await recorder.start();
  const started = performance.now();
  const body = {
    prompt: task.prompt,
    model_override: model,
    reasoning_effort: effort,
    window_label: "main",
    agent_id: agentId,
    device_contexts: await deviceContexts(userId, agentId),
    mode: "drawer",
    surface_id: "global",
    eval_turn_limit: turns,
  };
  let result = await client.run(body, taskMs, [], (event) => recorder.observe(event));
  // A run that failed before its first tool call with no answer never reached the agent (the
  // model provider was unreachable, say): run the task once more rather than grade nothing.
  if (result.terminal === "invocation.failed" && !result.tools.length && !result.answer.trim()) {
    process.stderr.write(`RETRY ${task.id.slice(0, 10)}: the run failed before any work\n`);
    result = await client.run(
      { ...body, device_contexts: await deviceContexts(userId, agentId) },
      taskMs,
      [],
      (event) => recorder.observe(event),
    );
  }
  const seconds = (performance.now() - started) / 1000;
  await recorder.finish(result.answer);
  return { task, dir, recorder, result, seconds };
}

/** Judges a recorded run and prices it; runs beside the next task's run. */
async function grade({ task, dir, recorder, result, seconds }: Performed): Promise<OdysseysRun> {
  const verdict = await judgeTask(judgeModel, task, recorder.steps, recorder.screenshots);
  const usage = await runUsage(result.invocationId).catch(() => undefined);
  const searches = result.tools.filter((tool) => tool === "web_search").length;
  const costUsd =
    (usage ? tokenUsd(model, usage.inputTokens, usage.cachedInputTokens, usage.outputTokens) : 0) +
    tokenUsd(judgeModel, verdict.inputTokens, 0, verdict.outputTokens) +
    searchesUsd(searches);
  ledger.add(costUsd);
  const run: OdysseysRun = {
    taskId: task.id,
    level: task.level,
    split: task.split,
    referenceLength: task.referenceLength,
    terminal: result.terminal,
    perfect: verdict.perfect,
    average: verdict.average,
    failed: verdict.rubrics
      .filter((item) => !item.success)
      .map(({ id, reasoning }) => ({ id, reasoning })),
    tools: result.tools,
    turns: usage?.turns ?? 0,
    seconds: Number(seconds.toFixed(1)),
    estimateMinutes: estimateOf(result.toolResults),
    costUsd: Number(costUsd.toFixed(4)),
    answer: result.answer.slice(0, 4_000),
    dir,
  };
  writeFileSync(
    join(dir, "result.json"),
    JSON.stringify({ ...run, prompt: task.prompt, rubrics: verdict.rubrics }, null, 2),
  );
  return run;
}

const failedRun = (task: OdysseysTask, dir: string, error: unknown): OdysseysRun => ({
  taskId: task.id,
  level: task.level,
  split: task.split,
  referenceLength: task.referenceLength,
  terminal: `error: ${String(error).slice(0, 200)}`,
  perfect: false,
  average: 0,
  failed: [],
  tools: [],
  turns: 0,
  seconds: 0,
  estimateMinutes: 0,
  costUsd: 0,
  answer: "",
  dir,
});

/** The agent's estimate from its checklist results (the tool echoes it back). */
function estimateOf(toolResults: string[]): number {
  for (const result of toolResults) {
    const match = /^log\.work\.checklist → .*"estimateMinutes":\s*(\d+)/s.exec(result);
    if (match) return Number(match[1]);
  }
  return 0;
}

/** "est 8m": the agent's own estimate, marked "over" when the run took more than half again. */
const estimate = (run: OdysseysRun) =>
  run.estimateMinutes
    ? ` est ${run.estimateMinutes}m${run.seconds > run.estimateMinutes * 60 * 1.5 ? " OVER" : ""}`
    : " est none";
const line = (run: OdysseysRun) =>
  `${run.perfect ? "PERFECT" : "FAIL"} ${run.level} ${run.taskId.slice(0, 10)} rubric ${run.average.toFixed(2)} ${run.seconds}s${estimate(run)} ${run.tools.length} tools $${run.costUsd.toFixed(3)} ${run.terminal}${run.failed.length ? ` — missed ${run.failed.map((item) => item.id).join(",")}` : ""}\n`;

/** Four failures among a batch's first six finished tasks stop the pass: fix before spending more. */
export function shouldStop(batch: OdysseysRun[]): boolean {
  // Runs that never reached the agent (the stack refused them) say nothing about it.
  const first = batch.filter((run) => !infrastructure(run)).slice(0, 6);
  return first.length === 6 && first.filter((run) => !run.perfect).length >= 4;
}

/** A run the stack refused before the agent worked on it. */
const infrastructure = (run: OdysseysRun) =>
  run.terminal.startsWith("error:") && run.tools.length === 0;

function summary(all: OdysseysRun[]) {
  const runs = all.filter((run) => !infrastructure(run));
  const median = (values: number[]) =>
    values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]! : 0;
  return {
    runs: runs.length,
    perfect: runs.filter((run) => run.perfect).length,
    perfectRate: runs.length
      ? Number((runs.filter((run) => run.perfect).length / runs.length).toFixed(3))
      : 0,
    rubricAverage: runs.length
      ? Number((runs.reduce((sum, run) => sum + run.average, 0) / runs.length).toFixed(3))
      : 0,
    medianSeconds: median(runs.map((run) => run.seconds)),
    medianToolCalls: median(runs.map((run) => run.tools.length)),
    medianStepsPerReference: Number(
      median(runs.map((run) => run.tools.length / Math.max(1, run.referenceLength))).toFixed(2),
    ),
    costUsd: Number(runs.reduce((sum, run) => sum + run.costUsd, 0).toFixed(4)),
  };
}

it.skipIf(env("MISTY_ODYSSEYS") !== "1")(
  "runs Odysseys tasks through the product path",
  async () => {
    if (!device || !bridge)
      throw new Error(
        "Odysseys needs this computer as the device: MISTY_WORKFLOW_EVAL_DEVICE and the eval bridge (README.md).",
      );
    const client = await EvalClient.open();
    // Stopping the pass (Ctrl-C, pkill) cancels the run in progress instead of leaving it spending.
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        const cancels = [...client.active].map((id) =>
          client.raw(`/ai/invocations/${id}/cancel`, { method: "POST" }).catch(() => undefined),
        );
        void Promise.all(cancels).finally(() => process.exit(130));
      });
    }
    const agentId =
      (await client.json<{ agents: Array<{ id: string }> }>("/misty/agents")).agents[0]?.id ?? "";
    const me = await client.json<{ id: string }>("/me");
    const tasks = selectTasks(loadTasks(), split, list(env("MISTY_ODYSSEYS_TASKS"))).slice(
      offset,
      offset + limit,
    );
    // The leak check (leak-check.ts): page processes before the pass, compared after it.
    const processesBefore = await pageProcesses(bridge);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const root = join(here, "reports", stamp);
    const runs: OdysseysRun[] = [];
    const grading: Array<Promise<void>> = [];
    let stopped = "";
    let refusedInARow = 0;
    // Several tasks at once, each agent with its own tabs (MISTY_ODYSSEYS_PARALLEL, 3 by default):
    // a batch takes a third of the time, and agents working side by side is what the product does.
    let next = 0;
    const lane = async () => {
      while (!stopped && next < tasks.length) {
        const task = tasks[next++]!;
        if (!ledger.allows()) {
          stopped = `cap: $${ledger.spent.toFixed(2)} of $${ledger.cap.toFixed(2)} spent`;
          return;
        }
        // Stop on the judgments that have come back, without waiting for the rest.
        if (earlyStop && shouldStop(runs)) {
          stopped = "4 of the first 6 tasks failed: attribute and fix before running more";
          return;
        }
        const dir = join(root, task.id.slice(0, 10));
        mkdirSync(dir, { recursive: true });
        let performed: Performed;
        try {
          performed = await perform(client, task, agentId, me.id, dir);
          refusedInARow = 0;
          // Out of AI usage, every later task would fail in a second: stop instead of grading them.
          if (/usage limit/i.test(performed.result.answer) && performed.result.tools.length < 3) {
            stopped =
              "the account is out of AI usage: raise the eval account's allowance, then run again";
            return;
          }
          if (performed.result.terminal === "timeout") {
            const counts = new Map<string, number>();
            for (const tool of performed.result.tools)
              counts.set(tool, (counts.get(tool) ?? 0) + 1);
            const busiest = [...counts]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 6)
              .map(([tool, count]) => `${tool} ×${count}`)
              .join(", ");
            stopped = `${task.id.slice(0, 10)} ran past ${taskMs / 60_000} minutes (${busiest}): find what it looped on and fix it before running more`;
            grading.push(
              grade(performed)
                .catch((error) => failedRun(task, dir, error))
                .then((run) => {
                  runs.push(run);
                  process.stderr.write(line(run));
                }),
            );
            return;
          }
        } catch (error) {
          const run = failedRun(task, dir, error);
          runs.push(run);
          process.stderr.write(line(run));
          if (++refusedInARow >= 3) {
            stopped = `three runs in a row never reached the agent (${run.terminal}): check the stack's logs and disk`;
            return;
          }
          continue;
        }
        grading.push(
          grade(performed)
            .catch((error) => failedRun(task, dir, error))
            .then((run) => {
              runs.push(run);
              process.stderr.write(line(run));
            }),
        );
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, parallel) }, () => lane()));
    await Promise.all(grading);
    if (!stopped && earlyStop && shouldStop(runs))
      stopped = "4 of the first 6 tasks failed: attribute and fix before running more";
    const leaked = processesBefore ? await leakedProcesses(bridge, processesBefore) : 0;
    if (leaked && !stopped) stopped = `the pass left ${leaked} WebKit page processes running: find the page that was not closed`;
    mkdirSync(root, { recursive: true });
    const report = {
      model,
      effort,
      judgeModel,
      split,
      offset,
      limit,
      stopped,
      ledgerUsd: Number(ledger.spent.toFixed(4)),
      pageProcesses: { before: processesBefore?.all.length, leaked },
      summary: summary(runs),
      runs,
    };
    writeFileSync(join(root, "report.json"), JSON.stringify(report, null, 2));
    process.stderr.write(
      `\n${JSON.stringify(report.summary)}\nCampaign spend $${ledger.spent.toFixed(2)} of $${ledger.cap.toFixed(2)}${stopped ? ` — stopped: ${stopped}` : ""}\nReport: ${join(root, "report.json")}\n`,
    );
    expect(runs.length + (stopped ? 1 : 0)).toBeGreaterThan(0);
  },
);
