// npm run regrade -- <task folder>
// Judges a saved run again from its steps and pictures, without running it: after a judge outage
// or a verdict the judge never gave. The pass's judge must be the one set now, so a pass never
// mixes judges, and the pass's report is brought up to date.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { judgeImagesFrom, judgeLanesFrom } from "./config.ts";
import { judgeFromEnv } from "./judge-config.ts";
import { judgeTask } from "./judge.ts";
import type { Step } from "./recorder.ts";
import { judgeRecord, loadPass } from "./report.ts";
import { line, summary, type OdysseysRun } from "./results.ts";
import { loadTasks, selectTasks } from "./tasks.ts";

const argument = process.argv[2];
if (!argument) throw new Error("Usage: npm run regrade -- <task folder>");
const dir = resolve(argument);
const judge = judgeFromEnv(process.env);
const maxImages = judgeImagesFrom(process.env);
const pass = loadPass(dirname(dir));
const wanted = judgeRecord(judge, maxImages);
if (pass.judge.model !== wanted.model || pass.judge.maxImages !== wanted.maxImages)
  throw new Error(`This pass was graded by ${pass.judge.model} with ${pass.judge.maxImages} pictures, not ${wanted.model} with ${wanted.maxImages}.`);

const previous = JSON.parse(readFileSync(join(dir, "result.json"), "utf8")) as OdysseysRun;
const task = selectTasks(loadTasks(), "all", [previous.taskId])[0];
if (!task) throw new Error(`No task ${previous.taskId} in the task data.`);
const steps = readFileSync(join(dir, "steps.jsonl"), "utf8").split("\n").filter(Boolean).map((row) => JSON.parse(row) as Step);
const pictures = steps.flatMap((step) => step.screenshots.map((file) => join(dir, file))).filter((file) => existsSync(file));
const verdict = await judgeTask(judge, task, steps, pictures, { maxImages, lanes: judgeLanesFrom(process.env) });
const run: OdysseysRun = {
  ...previous,
  perfect: verdict.perfect,
  average: verdict.average,
  failed: verdict.rubrics.filter((item) => !item.success).map(({ id, reasoning }) => ({ id, reasoning })),
  judgeErrors: verdict.rubrics.filter((item) => item.judgeError).length,
  judgeInputTokens: previous.judgeInputTokens + verdict.inputTokens,
  judgeOutputTokens: previous.judgeOutputTokens + verdict.outputTokens,
};
writeFileSync(join(dir, "result.json"), JSON.stringify({ ...run, prompt: task.prompt, rubrics: verdict.rubrics }, null, 2));
pass.runs = pass.runs.map((item) => (item.taskId === run.taskId ? run : item));
pass.summary = summary(pass.runs);
writeFileSync(join(dirname(dir), "report.json"), JSON.stringify(pass, null, 2));
process.stderr.write(line(run));
