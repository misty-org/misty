// Scores workflow runs. Answer quality and routing are kept apart, so a right
// answer reached the long way is a routing failure, not a pass.
import { matches, todayName, type WorkflowTask } from "./tasks.js";

export interface WorkflowRun {
  taskId: string;
  category: string;
  source: string;
  surface: string;
  model: string;
  terminal: string;
  /** Tool calls in order, as the model named them. */
  tools: string[];
  /** Screens the run asked for; each ends the run and needs another today. */
  screenRequests: string[];
  answer: string;
  ms: number;
  costUsd: number;
  answerPassed?: boolean;
  judgeReasons?: string[];
  routing: RoutingResult;
  error?: string;
}

export interface RoutingResult {
  passed: boolean;
  /** Each broken rule, in words. */
  broken: string[];
  /** Required tools that don't exist yet, so the rule can't be judged. */
  unavailable: string[];
  runs: number;
}

export function routing(task: WorkflowTask, tools: string[], screenRequests: string[]): RoutingResult {
  const rules = task.tools ?? {};
  const broken: string[] = [];
  const unavailable: string[] = [];
  for (const required of rules.required ?? []) {
    const name = todayName(required);
    if (name === null) unavailable.push(required);
    else if (!tools.some((called) => matches(name, called))) broken.push(`never called ${required}`);
  }
  for (const forbidden of rules.forbidden ?? []) {
    const name = todayName(forbidden);
    if (name === null) continue;
    const hit = tools.find((called) => matches(name, called));
    if (hit) broken.push(`called ${hit}`);
  }
  if (rules.maxCalls !== undefined && tools.length > rules.maxCalls) broken.push(`${tools.length} tool calls, at most ${rules.maxCalls}`);
  const runs = 1 + screenRequests.length;
  if (rules.maxRuns !== undefined && runs > rules.maxRuns) broken.push(`${runs} runs (screen hand-offs), at most ${rules.maxRuns}`);
  return { passed: broken.length === 0, broken, unavailable, runs };
}

export function expectPassed(answer: string, expected: string[] | undefined): boolean | undefined {
  if (!expected?.length) return undefined;
  const text = answer.toLowerCase();
  return expected.every((item) => text.includes(item.toLowerCase()));
}

export function passed(run: WorkflowRun): boolean {
  return !run.error && run.routing.passed && run.answerPassed !== false;
}

interface Summary {
  runs: number;
  passed: number;
  routingPassed: number;
  answerPassed: number;
  answerGraded: number;
  medianToolCalls: number;
  medianMs: number;
  handoffs: number;
  costUsd: number;
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

function summarize(runs: WorkflowRun[]): Summary {
  const graded = runs.filter((run) => run.answerPassed !== undefined);
  return {
    runs: runs.length,
    passed: runs.filter(passed).length,
    routingPassed: runs.filter((run) => run.routing.passed).length,
    answerPassed: graded.filter((run) => run.answerPassed).length,
    answerGraded: graded.length,
    medianToolCalls: median(runs.map((run) => run.tools.length)),
    medianMs: median(runs.map((run) => run.ms)),
    handoffs: runs.reduce((sum, run) => sum + run.screenRequests.length, 0),
    costUsd: Number(runs.reduce((sum, run) => sum + run.costUsd, 0).toFixed(4)),
  };
}

/** Summaries keyed "model" and "model · category". */
export function report(runs: WorkflowRun[]): Record<string, Summary> {
  const groups = new Map<string, WorkflowRun[]>();
  for (const run of runs) for (const key of [run.model, `${run.model} · ${run.category}`]) groups.set(key, [...(groups.get(key) ?? []), run]);
  return Object.fromEntries([...groups].map(([key, group]) => [key, summarize(group)]));
}
