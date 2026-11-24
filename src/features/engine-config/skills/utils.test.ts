// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
import { describe, expect, it } from "vitest";
import type { SkillRow, SkillTargetInfo, SkillUsageResult } from "./types";
import {
  copiedTargets,
  daysSince,
  formatTokens,
  nextTargets,
  relevantTargets,
  sortSkills,
  sourceKindOf,
  summarizeTargetResults,
  usageForSkill,
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

  it("formats token counts compactly", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(12_300)).toBe("12.3k");
    expect(formatTokens(2_500_000)).toBe("2.5M");
    expect(formatTokens(null)).toBe("0");
  });

  it("shows only engines holding a copy in the row strip", () => {
    const targets = [target("claude", true), target("codex", true), target("agy", false)];
    const row = skill({
      targetStates: { claude: "synced", codex: "off", agy: "orphan" },
    });
    expect(copiedTargets(row, targets).map((item) => item.id)).toEqual(["claude", "agy"]);
    expect(copiedTargets(skill({ targetStates: {} }), targets)).toEqual([]);
  });

  it("offers installed engines plus any engine holding a copy in the detail list", () => {
    const targets = [target("claude", true), target("codex", true), target("agy", false)];
    const row = skill({ targetStates: { claude: "synced", agy: "orphan" } });
    expect(relevantTargets(row, targets).map((item) => item.id)).toEqual([
      "claude",
      "codex",
      "agy",
    ]);
    const other = skill({ targetStates: { claude: "off", agy: "off" } });
    expect(relevantTargets(other, targets).map((item) => item.id)).toEqual(["claude", "codex"]);
  });

  it("computes the next target list per engine", () => {
    const row = skill({ targets: ["claude"], targetStates: { claude: "synced", codex: "off" } });
    expect(nextTargets(row, "codex", true)).toEqual(["claude", "codex"]);
    expect(nextTargets(row, "claude", false)).toEqual([]);
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
