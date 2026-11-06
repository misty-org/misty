// Two passes side by side: "same or better" as one plain check. Passes that didn't measure the
// same thing are refused, not compared.
import { scored, type OdysseysRun } from "./results.ts";
import { reportSchema, type PassReport } from "./report.ts";

export class CompareRefusal extends Error {}

export interface CompareRow {
  taskId: string;
  level: string;
  /** Null: this pass has no real score for the task. */
  baseline: number | null;
  candidate: number | null;
  baselinePerfect: boolean;
  candidatePerfect: boolean;
}

export interface Comparison {
  rows: CompareRow[];
  /** Tasks with a real score in both passes; the overall numbers cover only these. */
  both: number;
  baseline: { rubricAverage: number; perfect: number };
  candidate: { rubricAverage: number; perfect: number };
  unscored: string[];
  sameOrBetter: boolean;
}

/** The device settings that change what a run does. Speech and transcription don't. */
const comparedRoles = ["agent", "fast", "embedding"];

function refuseDifferences(a: PassReport, b: PassReport): void {
  for (const [name, pass] of [["baseline", a], ["candidate", b]] as const) {
    if (pass.schema !== reportSchema) throw new CompareRefusal(`The ${name} report has schema ${pass.schema}, not ${reportSchema}.`);
    if (pass.stopped) throw new CompareRefusal(`The ${name} pass did not finish (${pass.stopped}).`);
  }
  for (const role of comparedRoles) {
    const [left, right] = [a.device.models[role] ?? "none", b.device.models[role] ?? "none"];
    if (left !== right) throw new CompareRefusal(`The passes ran on different ${role} models: ${left} and ${right}.`);
  }
  if (a.device.reasoning !== b.device.reasoning) throw new CompareRefusal(`The passes ran at different reasoning: ${a.device.reasoning} and ${b.device.reasoning}.`);
  if (a.device.search !== b.device.search) throw new CompareRefusal(`The passes had different web search: ${a.device.search ?? "none"} and ${b.device.search ?? "none"}.`);
  if (a.dataSha256 !== b.dataSha256) throw new CompareRefusal("The passes used different task data.");
  const [left, right] = [[...a.taskIds].sort(), [...b.taskIds].sort()];
  if (left.length !== right.length || left.some((id, index) => id !== right[index])) {
    const onlyA = left.filter((id) => !right.includes(id)).length;
    const onlyB = right.filter((id) => !left.includes(id)).length;
    throw new CompareRefusal(`The passes have different task lists: ${onlyA} tasks only in the baseline, ${onlyB} only in the candidate.`);
  }
  if (a.turnLimit !== b.turnLimit) throw new CompareRefusal(`The passes had different turn limits: ${a.turnLimit} and ${b.turnLimit}.`);
  if (a.judge.model !== b.judge.model || a.judge.maxImages !== b.judge.maxImages)
    throw new CompareRefusal(`The passes were graded differently: ${a.judge.model} with ${a.judge.maxImages} pictures, and ${b.judge.model} with ${b.judge.maxImages}.`);
}

const scoreOf = (run: OdysseysRun | undefined) => (run && scored(run) ? run.average : null);

export function comparePasses(a: PassReport, b: PassReport): Comparison {
  refuseDifferences(a, b);
  const runsOf = (pass: PassReport) => new Map(pass.runs.map((run) => [run.taskId, run]));
  const [left, right] = [runsOf(a), runsOf(b)];
  const rows = a.taskIds.map((taskId): CompareRow => {
    const [one, two] = [left.get(taskId), right.get(taskId)];
    return {
      taskId,
      level: one?.level ?? two?.level ?? "",
      baseline: scoreOf(one),
      candidate: scoreOf(two),
      baselinePerfect: Boolean(one?.perfect && scoreOf(one) !== null),
      candidatePerfect: Boolean(two?.perfect && scoreOf(two) !== null),
    };
  });
  const complete = rows.filter((row) => row.baseline !== null && row.candidate !== null);
  const average = (pick: (row: CompareRow) => number) => (complete.length ? complete.reduce((sum, row) => sum + pick(row), 0) / complete.length : 0);
  const baseline = { rubricAverage: average((row) => row.baseline ?? 0), perfect: complete.filter((row) => row.baselinePerfect).length };
  const candidate = { rubricAverage: average((row) => row.candidate ?? 0), perfect: complete.filter((row) => row.candidatePerfect).length };
  const unscored = rows.filter((row) => row.baseline === null || row.candidate === null).map((row) => row.taskId);
  return {
    rows,
    both: complete.length,
    baseline,
    candidate,
    unscored,
    // A task without a score in both passes proves nothing, so it can't count as "same".
    sameOrBetter: complete.length > 0 && unscored.length === 0 && candidate.rubricAverage >= baseline.rubricAverage - 1e-9 && candidate.perfect >= baseline.perfect,
  };
}

const score = (value: number | null, perfect: boolean) => (value === null ? "no score" : `${value.toFixed(2)}${perfect ? " *" : ""}`);
const signed = (value: number, digits: number) => `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;

export function formatComparison(a: PassReport, b: PassReport, result: Comparison): string {
  const describe = (name: string, pass: PassReport) =>
    `${name}: ${pass.runtime}, ${pass.commit.misty?.sha.slice(0, 10) ?? "no commit"}${pass.commit.misty?.dirty ? " with uncommitted changes" : ""}, started ${pass.startedAt}`;
  const lines = [
    describe("Baseline", a),
    describe("Candidate", b),
    `Agent model: ${a.device.models.agent}, reasoning ${a.device.reasoning}, turn limit ${a.turnLimit}, judge ${a.judge.model}, ${a.taskIds.length} tasks`,
    "",
    `${"Task".padEnd(12)}${"Level".padEnd(8)}${"Baseline".padEnd(11)}${"Candidate".padEnd(11)}Change`,
  ];
  for (const row of result.rows) {
    const change = row.baseline !== null && row.candidate !== null ? signed(row.candidate - row.baseline, 2) : "";
    lines.push(`${row.taskId.slice(0, 10).padEnd(12)}${row.level.padEnd(8)}${score(row.baseline, row.baselinePerfect).padEnd(11)}${score(row.candidate, row.candidatePerfect).padEnd(11)}${change}`);
  }
  lines.push(
    "",
    `Overall, on the ${result.both} tasks scored in both passes (* is a perfect task):`,
    `  Rubric average  ${result.baseline.rubricAverage.toFixed(3)}  ${result.candidate.rubricAverage.toFixed(3)}  ${signed(result.candidate.rubricAverage - result.baseline.rubricAverage, 3)}`,
    `  Perfect tasks   ${result.baseline.perfect}/${result.both}  ${result.candidate.perfect}/${result.both}  ${signed(result.candidate.perfect - result.baseline.perfect, 0)}`,
  );
  if (result.unscored.length) lines.push(`  No score in one pass: ${result.unscored.map((id) => id.slice(0, 10)).join(", ")}`);
  lines.push("", `Same or better: ${result.sameOrBetter ? "yes" : "no"}`);
  return lines.join("\n") + "\n";
}
