import { useEffect, useMemo, useState } from "react";
import { useCachedResource } from "@/api/cache/cached_resource";
import { skillsHubApi, type DiscoveredSkill, type SkillRow } from "@/features/engine-config/skills";
import { failureText } from "./api";

export interface SkillEntry {
  key: string;
  name: string;
  description: string;
  repo: string | null;
  installs: number | null;
  link: string | null;
  row: SkillRow | null;
  found: DiscoveredSkill | null;
}

const skillKey = (owner: string | null, repo: string | null, directory: string) =>
  `${owner ?? ""}/${repo ?? ""}/${directory}`.toLowerCase();

const rowEntry = (row: SkillRow): SkillEntry => ({
  key: skillKey(row.repoOwner, row.repoName, row.directory),
  name: row.name,
  description: row.description,
  repo: row.repoOwner && row.repoName ? `${row.repoOwner}/${row.repoName}` : null,
  installs: null,
  link: row.readmeUrl,
  row,
  found: null,
});

export function skillEntries(found: DiscoveredSkill[], installed: SkillRow[]): SkillEntry[] {
  const rows = new Map(installed.map((row) => [rowEntry(row).key, row] as const));
  const seen = new Set<string>();
  const fromFound = found.map((skill): SkillEntry => {
    const key = skillKey(skill.repoOwner, skill.repoName, skill.directory);
    seen.add(key);
    const row = rows.get(key) ?? null;
    return {
      key,
      name: skill.name,
      description: skill.description || row?.description || "",
      repo: `${skill.repoOwner}/${skill.repoName}`,
      installs: skill.installs ?? null,
      link: skill.readmeUrl,
      row,
      found: skill,
    };
  });
  return [...installed.filter((row) => !seen.has(rowEntry(row).key)).map(rowEntry), ...fromFound];
}

export function entryMatches(entry: SkillEntry, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack =
    `${entry.name} ${entry.description} ${entry.row?.directory ?? entry.found?.directory ?? ""}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function useSkillCatalog(query: string) {
  const [term, setTerm] = useState(() => query.trim());
  useEffect(() => {
    const next = query.trim();
    if (next === term) return;
    const timer = window.setTimeout(() => setTerm(next), next ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [query, term]);
  const finding = useCachedResource(
    `agents/market-skills/found:${term}`,
    () =>
      term
        ? skillsHubApi.search(term, 0, 50).then((result) => result.skills)
        : skillsHubApi.discover().then((result) => result.skills),
    { persist: term ? false : "device" },
  );
  const [lastFound, setLastFound] = useState(finding.data);
  if (finding.data && finding.data !== lastFound) setLastFound(finding.data);
  const found: DiscoveredSkill[] | null = useMemo(
    () => finding.data ?? (finding.loading ? (lastFound ?? null) : (lastFound ?? [])),
    [finding.data, finding.loading, lastFound],
  );
  return {
    found,
    error:
      finding.error && !finding.refreshing
        ? failureText(finding.error, "The skills couldn't be listed.")
        : null,
    reload: () => void finding.reload(),
  };
}
