// One task's result, the pass's stop rule and its summary.
import type { OdysseysTask } from "./tasks.ts";

export interface OdysseysRun {
  taskId: string;
  level: string;
  split: string;
  referenceLength: number;
  terminal: string;
  /** The reason the event stream gave for a failed run. */
  error: string;
  perfect: boolean;
  average: number;
  failed: Array<{ id: string; reasoning: string }>;
  /** Rubrics the judge gave no verdict on: the score says nothing until they're judged again. */
  judgeErrors: number;
  /** The run made no call and wrote no answer, so it wasn't graded. */
  noWork: boolean;
  tools: string[];
  seconds: number;
  judgeInputTokens: number;
  judgeOutputTokens: number;
  answer: string;
  dir: string;
  invocationId: string;
  conversationId: string;
}

export const failedRun = (task: OdysseysTask, dir: string, error: unknown): OdysseysRun => ({
  taskId: task.id,
  level: task.level,
  split: task.split,
  referenceLength: task.referenceLength,
  terminal: `error: ${String(error).slice(0, 200)}`,
  error: "",
  perfect: false,
  average: 0,
  failed: [],
  judgeErrors: 0,
  noWork: true,
  tools: [],
  seconds: 0,
  judgeInputTokens: 0,
  judgeOutputTokens: 0,
  answer: "",
  dir,
  invocationId: "",
  conversationId: "",
});

export const line = (run: OdysseysRun) =>
  `${run.perfect ? "PERFECT" : "FAIL"} ${run.level} ${run.taskId.slice(0, 10)} rubric ${run.average.toFixed(2)} ${run.seconds}s ${run.tools.length} tools ${run.terminal}${run.failed.length ? `, missed ${run.failed.map((item) => item.id).join(",")}` : ""}\n`;

/** Four failures among a batch's first six finished tasks stop the pass: fix before spending more. */
export function shouldStop(batch: OdysseysRun[]): boolean {
  // Runs that never reached the agent (the stack refused them) say nothing about it.
  const first = batch.filter((run) => !infrastructure(run)).slice(0, 6);
  return first.length === 6 && first.filter((run) => !run.perfect).length >= 4;
}

/** A run the stack refused before the agent worked on it. */
export const infrastructure = (run: OdysseysRun) => run.terminal.startsWith("error:") && run.tools.length === 0;

/** A run with a real score: it did work and the judge gave every verdict. */
export const scored = (run: OdysseysRun) => !infrastructure(run) && !run.noWork && run.judgeErrors === 0;

export function summary(all: OdysseysRun[]) {
  const runs = all.filter((run) => !infrastructure(run));
  const median = (values: number[]) => (values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]! : 0);
  return {
    runs: runs.length,
    perfect: runs.filter((run) => run.perfect).length,
    perfectRate: runs.length ? Number((runs.filter((run) => run.perfect).length / runs.length).toFixed(3)) : 0,
    rubricAverage: runs.length ? Number((runs.reduce((sum, run) => sum + run.average, 0) / runs.length).toFixed(3)) : 0,
    medianSeconds: median(runs.map((run) => run.seconds)),
    medianToolCalls: median(runs.map((run) => run.tools.length)),
    medianStepsPerReference: Number(median(runs.map((run) => run.tools.length / Math.max(1, run.referenceLength))).toFixed(2)),
    judgeInputTokens: runs.reduce((sum, run) => sum + run.judgeInputTokens, 0),
    judgeOutputTokens: runs.reduce((sum, run) => sum + run.judgeOutputTokens, 0),
  };
}
