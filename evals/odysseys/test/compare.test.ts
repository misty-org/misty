import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CompareRefusal, comparePasses, formatComparison } from "../compare.ts";
import type { PassReport } from "../report.ts";
import { reportSchema } from "../report.ts";
import { summary, type OdysseysRun } from "../results.ts";

const ids = ["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"];

function run(taskId: string, average: number, extra: Partial<OdysseysRun> = {}): OdysseysRun {
  return {
    taskId, level: "hard", split: "dev", referenceLength: 10, terminal: "invocation.completed", error: "", perfect: average === 1, average,
    failed: [], judgeErrors: 0, noWork: false, tools: ["browser_run"], seconds: 60, judgeInputTokens: 0, judgeOutputTokens: 0, answer: "", dir: "", invocationId: "", conversationId: "", ...extra,
  };
}

function pass(scores: number[], extra: Partial<PassReport> = {}, runs?: OdysseysRun[]): PassReport {
  const all = runs ?? scores.map((score, index) => run(ids[index]!, score));
  return {
    schema: reportSchema, runtime: "typescript", startedAt: "2026-11-06T00:00:00Z", finishedAt: "2026-11-06T01:00:00Z",
    device: { models: { agent: "anthropic/agent-model", fast: "anthropic/fast-model", speech: "x/speech" }, reasoning: "low", search: "serper" },
    turnLimit: 100, parallel: 1, commit: { misty: { sha: "1234567890abcdef", dirty: false }, server: null },
    judge: { model: "google/judge", provider: "google", host: "generativelanguage.googleapis.com", maxImages: 60 },
    dataSha256: "same", split: "dev", offset: 0, limit: 3, taskIds: ids, stopped: "", pageProcesses: { before: 4, leaked: 0 }, summary: summary(all), runs: all, ...extra,
  };
}

describe("comparing passes", () => {
  it("is same or better when both scores hold or rise", () => {
    const result = comparePasses(pass([0.5, 1, 0]), pass([0.5, 1, 0.25], { runtime: "rust" }));
    expect(result.sameOrBetter).toBe(true);
    expect(result.both).toBe(3);
    expect(result.baseline).toEqual({ rubricAverage: 0.5, perfect: 1 });
    expect(result.candidate.rubricAverage).toBeCloseTo(0.5833, 3);
    expect(result.candidate.perfect).toBe(1);
  });

  it("counts identical passes as same", () => {
    expect(comparePasses(pass([0.1, 0.2, 0.3]), pass([0.1, 0.2, 0.3])).sameOrBetter).toBe(true);
  });

  it("isn't same or better when the average falls, or perfect tasks fall", () => {
    expect(comparePasses(pass([0.5, 0.5, 0.5]), pass([0.5, 0.5, 0.25])).sameOrBetter).toBe(false);
    // The average rises but a perfect task was lost.
    expect(comparePasses(pass([1, 0, 0]), pass([0.9, 0.9, 0.9])).sameOrBetter).toBe(false);
  });

  it("leaves a task without a real score out of the numbers, and never calls it same", () => {
    const candidate = pass([], {}, [run(ids[0]!, 1), run(ids[1]!, 1), run(ids[2]!, 0, { judgeErrors: 2 })]);
    const result = comparePasses(pass([1, 1, 1]), candidate);
    expect(result.both).toBe(2);
    expect(result.unscored).toEqual([ids[2]]);
    expect(result.sameOrBetter).toBe(false);
    expect(comparePasses(pass([1, 1, 1]), pass([], {}, [run(ids[0]!, 1), run(ids[1]!, 1), run(ids[2]!, 0, { noWork: true })])).unscored).toEqual([ids[2]]);
    expect(comparePasses(pass([1, 1, 1]), pass([], {}, [run(ids[0]!, 1), run(ids[1]!, 1)])).unscored).toEqual([ids[2]]);
    expect(comparePasses(pass([1, 1, 1]), pass([], {}, [run(ids[0]!, 1), run(ids[1]!, 1), run(ids[2]!, 0, { terminal: "error: 500", tools: [] })])).unscored).toEqual([ids[2]]);
  });

  it("matches tasks by id, whatever order they finished in", () => {
    const reversed = pass([], {}, [run(ids[2]!, 0.75), run(ids[1]!, 0.5), run(ids[0]!, 0.25)]);
    expect(comparePasses(pass([0.25, 0.5, 0.75]), reversed).rows.map((row) => row.candidate)).toEqual([0.25, 0.5, 0.75]);
  });

  it("prints scores side by side and the verdict", () => {
    const [a, b] = [pass([0.5, 1, 0]), pass([0.75, 1, 0], { runtime: "rust" })];
    const text = formatComparison(a, b, comparePasses(a, b));
    expect(text).toContain("Baseline: typescript, 1234567890");
    expect(text).toContain("Candidate: rust");
    expect(text).toMatch(/aaaaaaaaaa\s+hard\s+0\.50\s+0\.75\s+\+0\.25/);
    expect(text).toMatch(/bbbbbbbbbb\s+hard\s+1\.00 \*\s+1\.00 \*\s+\+0\.00/);
    expect(text).toMatch(/Rubric average\s+0\.500\s+0\.583\s+\+0\.083/);
    expect(text).toContain("Same or better: yes");
  });
});

describe("refusing to compare", () => {
  const base = pass([0.5, 0.5, 0.5]);
  const refused = (other: Partial<PassReport>, message: string) => {
    expect(() => comparePasses(base, pass([0.5, 0.5, 0.5], other))).toThrow(CompareRefusal);
    expect(() => comparePasses(base, pass([0.5, 0.5, 0.5], other))).toThrow(message);
  };

  it("refuses different agent or fast models", () => {
    refused({ device: { ...base.device, models: { ...base.device.models, agent: "openai/other" } } }, "different agent models");
    refused({ device: { ...base.device, models: { ...base.device.models, fast: "openai/other" } } }, "different fast models");
  });

  it("ignores models that play no part in a run", () => {
    expect(comparePasses(base, pass([0.5, 0.5, 0.5], { device: { ...base.device, models: { ...base.device.models, speech: "y/other" } } })).sameOrBetter).toBe(true);
  });

  it("refuses different reasoning or web search", () => {
    refused({ device: { ...base.device, reasoning: "high" } }, "different reasoning");
    refused({ device: { ...base.device, search: null } }, "different web search");
  });

  it("refuses different task lists, in either direction, but not a different order", () => {
    refused({ taskIds: [ids[0]!, ids[1]!] }, "different task lists");
    refused({ taskIds: [...ids, "dddddddddddd"] }, "different task lists");
    refused({ taskIds: [ids[0]!, ids[1]!, "dddddddddddd"] }, "1 tasks only in the baseline, 1 only in the candidate");
    expect(comparePasses(base, pass([0.5, 0.5, 0.5], { taskIds: [...ids].reverse() })).both).toBe(3);
  });

  it("refuses different task data, turn limits and judges", () => {
    refused({ dataSha256: "other" }, "different task data");
    refused({ turnLimit: 200 }, "different turn limits");
    refused({ judge: { ...base.judge, model: "anthropic/other" } }, "graded differently");
    refused({ judge: { ...base.judge, maxImages: 24 } }, "graded differently");
  });

  it("refuses a pass that didn't finish, on either side", () => {
    refused({ stopped: "the pass was still running" }, "candidate pass did not finish");
    expect(() => comparePasses(pass([1, 1, 1], { stopped: "4 of the first 6 tasks failed" }), base)).toThrow("baseline pass did not finish");
  });

  it("refuses a report it can't read", () => {
    refused({ schema: 99 }, "schema 99");
  });
});

describe("the compare command", () => {
  const folder = (report: PassReport) => {
    const dir = mkdtempSync(join(tmpdir(), "odysseys-compare-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "report.json"), JSON.stringify(report));
    return dir;
  };
  const compare = (...args: string[]) => spawnSync(process.execPath, [resolve(import.meta.dirname, "../compare-cli.ts"), ...args], { encoding: "utf8" });

  it("exits 0 for same or better, 1 for worse", () => {
    const same = compare(folder(pass([0.5, 0.5, 0.5])), folder(pass([0.5, 0.5, 0.5])));
    expect(same.status).toBe(0);
    expect(same.stdout).toContain("Same or better: yes");
    const worse = compare(folder(pass([0.5, 0.5, 0.5])), folder(pass([0, 0.5, 0.5])));
    expect(worse.status).toBe(1);
    expect(worse.stdout).toContain("Same or better: no");
  });

  it("exits 2 and prints no scores when it refuses", () => {
    const result = compare(folder(pass([0.5, 0.5, 0.5])), folder(pass([1, 1, 1], { turnLimit: 50 })));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Refused: The passes had different turn limits");
    expect(result.stdout).toBe("");
  });

  it("exits 2 for a missing folder or argument", () => {
    expect(compare(join(tmpdir(), "no-such-pass"), join(tmpdir(), "no-such-pass")).status).toBe(2);
    expect(compare().status).toBe(2);
  });
});
