// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
import type {
  SkillRow,
  SkillSourceKind,
  SkillTargetId,
  SkillTargetInfo,
  SkillTargetResult,
  SkillUsageEntry,
  SkillUsageResult,
} from "./types";

export function sourceKindOf(skill: Pick<SkillRow, "managed" | "sourceKind">): SkillSourceKind {
  if (skill.sourceKind) return skill.sourceKind;
  return skill.managed ? "managed" : "local";
}

export function sortSkills(skills: SkillRow[]): SkillRow[] {
  return [...skills].sort((a, b) => {
    const aManaged = sourceKindOf(a) === "managed" ? 0 : 1;
    const bManaged = sourceKindOf(b) === "managed" ? 0 : 1;
    if (aManaged !== bManaged) return aManaged - bManaged;
    return a.name.localeCompare(b.name);
  });
}

export function copiedTargets(skill: SkillRow, targets: SkillTargetInfo[]): SkillTargetInfo[] {
  return targets.filter((target) => (skill.targetStates?.[target.id] ?? "off") !== "off");
}

export function relevantTargets(skill: SkillRow, targets: SkillTargetInfo[]): SkillTargetInfo[] {
  return targets.filter((target) => {
    if (target.available !== false) return true;
    return (skill.targetStates?.[target.id] ?? "off") !== "off";
  });
}

export function nextTargets(
  skill: SkillRow,
  targetId: SkillTargetId,
  enabled: boolean,
): SkillTargetId[] {
  const current = skill.targets ?? [];
  if (enabled) return [...new Set([...current, targetId])];
  return current.filter((target) => target !== targetId);
}

export function usageForSkill(
  usage: SkillUsageResult | null,
  skill: SkillRow,
): SkillUsageEntry | null {
  if (!usage) return null;
  const byId = usage.skills.find((entry) => entry.skillId === skill.id);
  if (byId) return byId;
  const directory = skill.directory.trim().toLowerCase();
  const byDirectory = usage.skills.find(
    (entry) => (entry.directory ?? "").trim().toLowerCase() === directory,
  );
  if (byDirectory) return byDirectory;
  const leaf = directory.split("/").filter(Boolean).pop();
  if (!leaf) return null;
  const byName = usage.skills.filter((entry) => entry.skill.trim().toLowerCase() === leaf);
  return byName.length === 1 ? byName[0] : null;
}

export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

interface TargetResultSummary {
  allOk: boolean;
  failed: { target: string; error: string | null }[];
}

export function summarizeTargetResults(
  results: SkillTargetResult[] | undefined,
): TargetResultSummary {
  const failed = (results ?? [])
    .filter((result) => !result.ok)
    .map((result) => ({ target: result.target, error: result.error }));
  return { allOk: failed.length === 0, failed };
}

export function relativeToRoot(
  picked: string,
  targets: SkillTargetInfo[],
): { directory: string; target: SkillTargetInfo } | null {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalized = normalize(picked);
  let best: { directory: string; target: SkillTargetInfo } | null = null;
  for (const target of targets) {
    const root = normalize(target.path);
    if (!root) continue;
    if (normalized === root) continue;
    if (normalized.startsWith(`${root}/`)) {
      const directory = normalized.slice(root.length + 1);
      if (!best || root.length > normalize(best.target.path).length) {
        best = { directory, target };
      }
    }
  }
  return best;
}

export function defaultTargets(offered: SkillTargetInfo[]): SkillTargetId[] {
  const preferred = offered
    .filter((target) => target.id === "claude" || target.id === "codex")
    .map((target) => target.id as SkillTargetId);
  if (preferred.length > 0) return preferred;
  return offered.slice(0, 1).map((target) => target.id as SkillTargetId);
}

export function formatTokens(value: number | null | undefined): string {
  const tokens = value ?? 0;
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}
