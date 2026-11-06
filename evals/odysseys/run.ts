// The Odysseys benchmark through Misty's product path (docs/agents/evals/odysseys.md): each task
// is a composer request on the local stack, with this computer as the device, so the agent does
// what it does for a person, on the device's own models. It knows nothing of how the runtime is
// built, so the same pass measures the TypeScript runtime and the Rust one.
//
//   npm run pass
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deviceModels } from "./bridge.ts";
import { EvalClient, FatalPassError } from "./client.ts";
import { loadConfig } from "./config.ts";
import { chooseDevice, deviceContexts, type AccountDevice } from "./device.ts";
import { leakedProcesses, pageProcesses } from "./leak-check.ts";
import { didNoWork, grade, perform } from "./perform.ts";
import { commits, judgeRecord, reportSchema, type PassReport } from "./report.ts";
import { failedRun, line, shouldStop, summary, type OdysseysRun } from "./results.ts";
import { dataSha256, loadTasks, selectTasks } from "./tasks.ts";

// A refusal is a plain sentence, not a stack trace.
process.on("uncaughtException", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
});

const config = loadConfig(process.env);
const tasks = selectTasks(loadTasks(), config.split, config.ids).slice(config.offset, config.offset + config.limit);
if (!tasks.length) throw new Error("That selection has no tasks.");

const client = await EvalClient.open(config.api, config.signInFile);
const me = await client.json<{ id: string }>("/me");
const agentId = (await client.json<{ agents: Array<{ id: string }> }>("/misty/agents")).agents[0]?.id ?? "";
if (!agentId) throw new Error("This account has no agent.");
const { devices } = await client.json<{ devices: AccountDevice[] }>("/devices");
const identity = { userId: me.id, agentId, deviceId: chooseDevice(devices, config.deviceId) };

// The run's model comes from the device. A pass with none would measure nothing.
const device = await deviceModels(config.bridge);
if (!device.models.agent) throw new Error("This device has no usable agent model. Save a model key and choose an agent model in the dev app's Settings › Models.");
// The desktop must be signed in to this account on this server, or nothing it signs will count.
await deviceContexts(config.bridge, config.deviceApiBase, identity.deviceId, identity.userId, identity.agentId);

// Stopping the pass (Ctrl-C) cancels the runs in progress instead of leaving them spending.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void Promise.all([...client.active].map((id) => client.cancel(id))).finally(() => process.exit(130));
  });
}

const startedAt = new Date().toISOString();
const root = join(config.reportsDir, `${startedAt.replace(/[:.]/g, "-")}-${config.runtime}`);
mkdirSync(root, { recursive: true });
const processesBefore = await pageProcesses(config.bridge);
const commit = commits();
const data = dataSha256();
const runs: OdysseysRun[] = [];
const grading: Array<Promise<void>> = [];
let stopped = "";
let refusedInARow = 0;
let leaked = 0;

const save = (reason: string) => {
  const report: PassReport = {
    schema: reportSchema,
    runtime: config.runtime,
    startedAt,
    finishedAt: new Date().toISOString(),
    device,
    turnLimit: config.turns,
    parallel: config.parallel,
    commit,
    judge: judgeRecord(config.judge, config.judgeImages),
    dataSha256: data,
    split: config.ids.length ? "tasks" : config.split,
    offset: config.offset,
    limit: config.limit,
    taskIds: tasks.map((task) => task.id),
    stopped: reason,
    pageProcesses: { before: processesBefore?.all.length, leaked },
    summary: summary(runs),
    runs,
  };
  writeFileSync(join(root, "report.json"), JSON.stringify(report, null, 2));
  return report;
};
const finished = (run: OdysseysRun) => {
  runs.push(run);
  process.stderr.write(line(run));
  // A report after every task, so a crash or Ctrl-C keeps what's done. It stays marked unfinished.
  save(stopped || "the pass was still running");
};
save("the pass was still running");

// Tasks run one at a time by default, so timing and memory compare cleanly. Agents side by side
// are what MISTY_ODYSSEYS_PARALLEL is for.
let next = 0;
const lane = async () => {
  while (!stopped && next < tasks.length) {
    const task = tasks[next++]!;
    // Stop on the judgments that have come back, without waiting for the rest.
    if (config.earlyStop && shouldStop(runs)) {
      stopped = "4 of the first 6 tasks failed: attribute and fix before running more";
      return;
    }
    const dir = join(root, task.id.slice(0, 10));
    mkdirSync(dir, { recursive: true });
    try {
      const performed = await perform(config, client, task, identity, dir);
      const noWork = didNoWork(performed.result);
      process.stderr.write(`RUN ENDED ${task.id.slice(0, 10)} ${performed.result.terminal} ${performed.seconds.toFixed(0)}s ${performed.result.tools.length} tools, ${noWork ? "no work, not graded" : "grading"} ${dir}\n`);
      refusedInARow = noWork ? refusedInARow + 1 : 0;
      grading.push(grade(config, performed).catch((error: unknown) => failedRun(task, dir, error)).then(finished));
      if (performed.result.terminal === "timeout") {
        stopped = `${task.id.slice(0, 10)} ran past its ${config.taskMs / 60_000} minutes: find what it looped on before running more`;
        return;
      }
    } catch (error) {
      if (error instanceof FatalPassError) {
        stopped = error.message;
        return;
      }
      finished(failedRun(task, dir, error));
      refusedInARow++;
    }
    if (refusedInARow >= 3) {
      stopped = "three runs in a row did no work: check the stack's logs, the app and the model key";
      return;
    }
  }
};
await Promise.all(Array.from({ length: config.parallel }, () => lane()));
await Promise.all(grading);
if (!stopped && config.earlyStop && runs.length < tasks.length && shouldStop(runs))
  stopped = "4 of the first 6 tasks failed: attribute and fix before running more";

// The model the report names must be the one every task ran on.
const after = await deviceModels(config.bridge).catch(() => undefined);
if (!stopped && JSON.stringify(after) !== JSON.stringify(device)) stopped = "the device's model settings changed during the pass";
leaked = processesBefore ? await leakedProcesses(config.bridge, processesBefore) : 0;

const report = save(stopped);
process.stderr.write(
  `\n${JSON.stringify(report.summary)}\n${stopped ? `Stopped: ${stopped}\n` : ""}${leaked ? `The pass left ${leaked} WebKit page processes running.\n` : ""}Report: ${join(root, "report.json")}\n`,
);
