// Running one task through the product path, then judging it.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalClient, EvalRun } from "./client.ts";
import type { Config } from "./config.ts";
import { deviceContexts } from "./device.ts";
import { judgeTask } from "./judge.ts";
import { Recorder } from "./recorder.ts";
import type { OdysseysRun } from "./results.ts";
import type { OdysseysTask } from "./tasks.ts";
import { ProgressWatch } from "./watchdog.ts";

export interface Identity {
  userId: string;
  agentId: string;
  deviceId: string;
}

export interface Performed {
  task: OdysseysTask;
  dir: string;
  recorder: Recorder;
  result: EvalRun;
  seconds: number;
}

/** A composer request, as the app sends one. The model is never named: the device's settings choose it. */
export const composerRequest = (task: OdysseysTask, identity: Identity, contexts: unknown[]) => ({
  prompt: task.prompt,
  agent_id: identity.agentId,
  window_label: "main",
  mode: "drawer",
  surface_id: "global",
  origin_device_id: identity.deviceId,
  device_contexts: contexts,
  // Without pauses: nobody is there to answer. Paying and the like still ask, and stop the run.
  permission_mode: "auto",
  collaboration_mode: "act",
});

/** A run that made no call and wrote no answer (cancelled, or refused at the start) did no work. */
export const didNoWork = (result: EvalRun) => !result.tools.length && !result.answer.trim();

/** Runs one task through the product path and records it; grading comes later. */
export async function perform(config: Config, client: EvalClient, task: OdysseysTask, identity: Identity, dir: string): Promise<Performed> {
  const recorder = new Recorder(dir, config.bridge);
  await recorder.start();
  const watch = new ProgressWatch(task.id.slice(0, 10));
  const options = {
    timeoutMs: config.taskMs,
    turns: config.turns,
    observe: (event: Record<string, unknown>) => {
      watch.observe(event);
      return recorder.observe(event);
    },
    watch: {
      everyMs: config.watchMs,
      check: async (invocationId: string) => {
        watch.results(await client.toolOutputs(invocationId).catch(() => []));
        return watch.check();
      },
    },
  };
  const contexts = () => deviceContexts(config.bridge, config.deviceApiBase, identity.deviceId, identity.userId, identity.agentId);
  const started = performance.now();
  let result = await client.run(composerRequest(task, identity, await contexts()), options);
  // A run that failed before its first tool call with no answer never reached the agent (the
  // model provider was unreachable, say): run the task once more rather than grade nothing.
  if (result.terminal === "invocation.failed" && didNoWork(result)) {
    process.stderr.write(`RETRY ${task.id.slice(0, 10)}: the run failed before any work (${result.error})\n`);
    result = await client.run(composerRequest(task, identity, await contexts()), options);
  }
  const seconds = (performance.now() - started) / 1000;
  // Outputs are stored just after each call ends, so the last ones may trail the run by a moment.
  await new Promise((done) => setTimeout(done, 2_000));
  recorder.applyOutputs(await client.toolOutputs(result.invocationId).catch(() => []));
  await recorder.finish(result.answer);
  return { task, dir, recorder, result, seconds };
}

/** Judges a recorded run; runs beside the next task's run. A run that did no work is not sent to
 * the judge: every rubric fails, and minutes of grading are saved. */
export async function grade(config: Config, { task, dir, recorder, result, seconds }: Performed): Promise<OdysseysRun> {
  const noWork = didNoWork(result);
  const verdict = noWork
    ? {
        rubrics: task.rubrics.map((rubric) => ({ id: rubric.id, success: false, reasoning: `Not graded: the run did no work (${result.terminal}).`, judgeError: false })),
        average: 0, perfect: false, inputTokens: 0, outputTokens: 0,
      }
    : await judgeTask(config.judge, task, recorder.steps, recorder.screenshots, { maxImages: config.judgeImages, lanes: config.judgeLanes });
  const run: OdysseysRun = {
    taskId: task.id,
    level: task.level,
    split: task.split,
    referenceLength: task.referenceLength,
    terminal: result.terminal,
    error: result.error.slice(0, 500),
    perfect: verdict.perfect,
    average: verdict.average,
    failed: verdict.rubrics.filter((item) => !item.success).map(({ id, reasoning }) => ({ id, reasoning })),
    judgeErrors: verdict.rubrics.filter((item) => item.judgeError).length,
    noWork,
    tools: result.tools,
    seconds: Number(seconds.toFixed(1)),
    judgeInputTokens: verdict.inputTokens,
    judgeOutputTokens: verdict.outputTokens,
    answer: result.answer.replace(/\s*<!--misty-ledger:[\s\S]*?-->\s*$/, "").slice(0, 4_000),
    dir,
    invocationId: result.invocationId,
    conversationId: result.conversationId,
  };
  writeFileSync(join(dir, "result.json"), JSON.stringify({ ...run, prompt: task.prompt, rubrics: verdict.rubrics }, null, 2));
  return run;
}
