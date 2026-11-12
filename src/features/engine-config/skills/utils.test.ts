// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
import { describe, expect, it } from "vitest";
import type { SkillRow, SkillTargetInfo, SkillUsageResult } from "./types";
import {
  copiedTargets,
  daysSince,
  filterSkills,
  formatTokens,
  hasOrphanCopy,
  nextTargets,
  relevantTargets,
  sortSkills,
  sourceKindOf,
  summarizeTargetResults,
  syncedTargets,
  usageForSkill,
  visibleEngines,
} from "./utils";

function target(id: string, available: boolean): SkillTargetInfo {
  return { id, label: id, path: `/home/u/.${id}/skills`, readonly: false, available };
}

function skill(overrides: Partial<SkillRow> = {}): SkillRow {
  return {
    id: "local:alpha",
    key: "local:alpha",
    name: "Alpha",
    description: "does things",
    directory: "alpha",
    readmeUrl: null,
    repoOwner: null,
    repoName: null,
    repoBranch: null,
    installedAt: null,
    managed: false,
    sourceKind: "local",
    readonly: false,
    targets: ["claude"],
    targetStates: { claude: "synced", codex: "off" },
    ...overrides,
  };
}

describe("skills utils", () => {
  it("classifies legacy payloads without sourceKind", () => {
    expect(sourceKindOf({ managed: true, sourceKind: undefined as never })).toBe("managed");
    expect(sourceKindOf({ managed: false, sourceKind: undefined as never })).toBe("local");
  });

  it("filters by query and target state", () => {
    const rows = [
      skill({ id: "a", name: "Alpha", sourceKind: "managed", managed: true }),
      skill({ id: "b", name: "Beta", sourceKind: "local" }),
      skill({
        id: "c",
        name: "Gamma",
        sourceKind: "builtin",
        readonly: true,
        targetStates: { claude: "off", codex: "off" },
      }),
    ];
    expect(filterSkills(rows, { query: "bet", target: "" })).toHaveLength(1);
    expect(filterSkills(rows, { query: "", target: "claude" })).toHaveLength(2);
    expect(filterSkills(rows, { query: "gamma", target: "claude" })).toHaveLength(0);
  });

  it("sorts managed first, then by name", () => {
    const rows = [
      skill({ id: "z", name: "zeta" }),
      skill({ id: "a", name: "alpha", managed: true, sourceKind: "managed" }),
      skill({ id: "m", name: "mid" }),
    ];
    expect(sortSkills(rows).map((row) => row.name)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("summarizes per-target results without hiding partial failures", () => {
    expect(summarizeTargetResults(undefined).allOk).toBe(true);
    const partial = summarizeTargetResults([
      { target: "claude", ok: true, error: null },
      { target: "codex", ok: false, error: "permission denied" },
    ]);
    expect(partial.allOk).toBe(false);
    expect(partial.failed).toEqual([{ target: "codex", error: "permission denied" }]);
  });

  it("reports synced targets and orphan copies", () => {
    const row = skill({
      targets: ["claude", "codex"],
      targetStates: { claude: "synced", codex: "orphan" },
    });
    expect(syncedTargets(row)).toEqual(["claude"]);
    expect(hasOrphanCopy(row)).toBe(true);
  });

  it("formats token counts compactly", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(12_300)).toBe("12.3k");
    expect(formatTokens(2_500_000)).toBe("2.5M");
    expect(formatTokens(null)).toBe("0");
  });

  it("shows only engines holding a copy in the row strip", () => {
    const targets = [target("claude", true), target("grok", true), target("hermes", false)];
    const row = skill({
      targetStates: { claude: "synced", grok: "off", hermes: "orphan" },
    });
    expect(copiedTargets(row, targets).map((item) => item.id)).toEqual(["claude", "hermes"]);
    expect(copiedTargets(skill({ targetStates: {} }), targets)).toEqual([]);
  });

  it("offers installed engines plus any engine holding a copy in the detail list", () => {
    const targets = [target("claude", true), target("grok", true), target("hermes", false)];
    const row = skill({ targetStates: { claude: "synced", hermes: "orphan" } });
    // An engine that isn't installed but holds a copy (or lost one) still shows: the way to clean up mustn't disappear.
    expect(relevantTargets(row, targets).map((item) => item.id)).toEqual([
      "claude",
      "grok",
      "hermes",
    ]);
    const other = skill({ targetStates: { claude: "off", hermes: "off" } });
    expect(relevantTargets(other, targets).map((item) => item.id)).toEqual(["claude", "grok"]);
  });

  it("derives engine filter chips from the whole list", () => {
    const targets = [target("claude", true), target("codex", false), target("hermes", false)];
    const skills = [
      skill({ targetStates: { claude: "synced", codex: "off", hermes: "off" } }),
      skill({ id: "b", targetStates: { claude: "off", codex: "orphan", hermes: "off" } }),
    ];
    expect(visibleEngines(skills, targets).map((item) => item.id)).toEqual(["claude", "codex"]);
  });

  it("computes the next target list per engine", () => {
    const row = skill({ targets: ["claude"], targetStates: { claude: "synced", grok: "off" } });
    expect(nextTargets(row, "grok", true)).toEqual(["claude", "grok"]);
    expect(nextTargets(row, "claude", false)).toEqual([]);
    // orphan: the backend lists only synced targets, so turning it on adds the id back.
    const orphan = skill({
      targets: ["claude"],
      targetStates: { claude: "synced", codex: "orphan" },
    });
    expect(nextTargets(orphan, "codex", true)).toEqual(["claude", "codex"]);
  });

  it("joins usage by skill id, directory or a unique name", () => {
    const usage: SkillUsageResult = {
      engine: "claude",
      scope: "claude_code_transcripts",
      generatedAt: 1,
      scannedFiles: 1,
      totalInvocations: 3,
      cached: false,
      skills: [
        {
          skill: "alpha",
          invocations: 3,
          lastUsedAt: "2026-01-01T00:00:00.000Z",
          tokens: null,
          installed: true,
          skillId: "local:alpha",
          directory: "alpha",
        },
        {
          skill: "twin",
          invocations: 1,
          lastUsedAt: null,
          tokens: null,
          installed: false,
          skillId: null,
          directory: null,
        },
      ],
      unusedInstalled: [],
    };
    expect(usageForSkill(usage, skill())?.invocations).toBe(3);
    expect(usageForSkill(usage, skill({ id: "other", directory: "alpha" }))?.invocations).toBe(3);
    // An ambiguous name that matched no installed skill mustn't take another skill's calls.
    const twins = [
      skill({ id: "x", name: "twin", directory: "twin-a" }),
      skill({ id: "y", name: "twin", directory: "twin-b" }),
    ];
    for (const row of twins) expect(usageForSkill(usage, row)).toBeNull();
    expect(usageForSkill(null, skill())).toBeNull();
  });

  it("computes whole days since a timestamp without going negative", () => {
    const now = Date.parse("2026-01-10T12:00:00.000Z");
    expect(daysSince("2026-01-08T12:00:00.000Z", now)).toBe(2);
    expect(daysSince("2026-01-10T20:00:00.000Z", now)).toBe(0);
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince("not-a-date", now)).toBeNull();
  });
});
