import { Download, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCachedResource } from "@/api/cache/cached-resource";
import {
  skillsHubApi,
  type DiscoveredSkill,
  type SkillRow,
  type SkillTargetId,
} from "@/features/engine-config/skills";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  Button,
  CatalogCard,
  CatalogDone,
  CatalogGrid,
  EmptyState,
  ListRowSkeleton,
  MenuItem,
  notify,
  SectionHeading,
  useConfirmDelete,
} from "@/shared/ui";
import { failureText } from "./api";
import { MakerLogo, pluginMaker, sourceLabel } from "./PluginMaker";

const installsFormat = new Intl.NumberFormat(undefined, { notation: "compact" });

/** One skill as the page shows it: found in a repository or on skills.sh, installed or not. */
interface SkillEntry {
  key: string;
  name: string;
  description: string;
  repo: string | null;
  installs: number | null;
  link: string | null;
  /** The hub's copy, when the skill is installed for any engine. */
  row: SkillRow | null;
  /** What to install from, when it was found rather than only installed. */
  found: DiscoveredSkill | null;
}

/** Skills are matched across lists by where they live: owner/repo and the folder in it. */
const skillKey = (owner: string | null, repo: string | null, directory: string) =>
  `${owner ?? ""}/${repo ?? ""}/${directory}`.toLowerCase();

function entries(found: DiscoveredSkill[], installed: SkillRow[]): SkillEntry[] {
  const rows = new Map(
    installed.map((row) => [skillKey(row.repoOwner, row.repoName, row.directory), row] as const),
  );
  const seen = new Set<string>();
  const fromFound = found.map((skill) => {
    const key = skillKey(skill.repoOwner, skill.repoName, skill.directory);
    seen.add(key);
    return {
      key,
      name: skill.name,
      description: skill.description,
      repo: `${skill.repoOwner}/${skill.repoName}`,
      installs: skill.installs ?? null,
      link: skill.readmeUrl,
      row: rows.get(key) ?? null,
      found: skill,
    };
  });
  const onlyInstalled = installed
    .filter((row) => !seen.has(skillKey(row.repoOwner, row.repoName, row.directory)))
    .map((row) => ({
      key: skillKey(row.repoOwner, row.repoName, row.directory),
      name: row.name,
      description: row.description,
      repo: row.repoOwner && row.repoName ? `${row.repoOwner}/${row.repoName}` : null,
      installs: null,
      link: row.readmeUrl,
      row,
      found: null,
    }));
  return [...onlyInstalled, ...fromFound];
}

const inEngine = (entry: SkillEntry, target: SkillTargetId) =>
  Boolean(entry.row && entry.row.targetStates[target] === "synced");

/**
 * Agent Skills for one engine, from the skills hub: the hub keeps one copy of each skill and syncs
 * it into each engine's own skills folder. The list starts with the hub's repositories (credible
 * defaults the person can change in Settings › Skills) and searches skills.sh as the person types.
 */
export function EngineSkills({
  target,
  engineName,
  query,
  installedOnly,
}: {
  target: SkillTargetId;
  engineName: string;
  query: string;
  installedOnly: boolean;
}) {
  // A typed search waits for a pause; browsing lists at once.
  const [term, setTerm] = useState(() => query.trim());
  useEffect(() => {
    const next = query.trim();
    if (next === term) return;
    const timer = window.setTimeout(() => setTerm(next), next ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [query, term]);
  // The hub's installed skills and what it found are kept on this computer: they paint at once
  // and are listed anew behind them. A search is kept for this session only.
  const hub = useCachedResource("agents/market-skills/installed", () => skillsHubApi.installed(), {
    persist: "device",
  });
  const finding = useCachedResource(
    `agents/market-skills/found:${term}`,
    () =>
      term
        ? skillsHubApi.search(term, 0, 50).then((result) => result.skills)
        : skillsHubApi.discover().then((result) => result.skills),
    { persist: term ? false : "device" },
  );
  // A new search keeps the last results on screen until its own arrive.
  const [lastFound, setLastFound] = useState(finding.data);
  if (finding.data && finding.data !== lastFound) setLastFound(finding.data);
  const found: DiscoveredSkill[] | null = useMemo(
    () => finding.data ?? (finding.loading ? (lastFound ?? null) : (lastFound ?? [])),
    [finding.data, finding.loading, lastFound],
  );
  const installed: SkillRow[] | null = useMemo(
    () => hub.data?.skills ?? (hub.loading ? null : []),
    [hub.data?.skills, hub.loading],
  );
  const failure = finding.error ?? hub.error;
  const error =
    failure && !finding.refreshing && !hub.refreshing
      ? failureText(failure, "The skills couldn't be listed.")
      : null;
  const [busy, setBusy] = useState<string | null>(null);
  const { confirm, dialog } = useConfirmDelete();

  const { reload: reloadInstalled } = hub;
  const loadInstalled = useCallback(async () => {
    await reloadInstalled();
  }, [reloadInstalled]);

  const list = useMemo(() => {
    if (!found || !installed) return null;
    const all = entries(found, installed);
    return installedOnly ? all.filter((entry) => inEngine(entry, target)) : all;
  }, [found, installed, installedOnly, target]);

  const install = async (entry: SkillEntry) => {
    setBusy(entry.key);
    try {
      if (entry.row) {
        await skillsHubApi.setTargets(entry.row.id, [...entry.row.targets, target]);
      } else if (entry.found) {
        await skillsHubApi.install(entry.found, [target]);
      }
      await loadInstalled();
    } catch (reason) {
      notify({
        message: failureText(reason, `${entry.name} couldn't be installed.`),
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (entry: SkillEntry) => {
    const row = entry.row;
    if (!row) return;
    await confirm({
      title: `Remove ${entry.name} from ${engineName}?`,
      what: "Other engines that use it keep it.",
      confirmLabel: "Remove",
      onConfirm: async () => {
        try {
          const rest = row.targets.filter((id) => id !== target);
          if (rest.length) await skillsHubApi.setTargets(row.id, rest);
          else await skillsHubApi.uninstall(row.id);
          await loadInstalled();
        } catch (reason) {
          notify({
            message: failureText(reason, `${entry.name} couldn't be removed.`),
            tone: "error",
          });
        }
      },
    });
  };

  if (!list)
    return (
      <ListRowSkeleton label={`${engineName} skills`} rows={10} lines={2} trailing="button-sm" />
    );
  if (error && !list.length)
    return (
      <EmptyState
        title="The skills couldn't be listed"
        line={error}
        action={{
          label: "Try again",
          icon: RefreshCw,
          onClick: () => {
            void finding.reload();
            void hub.reload();
          },
        }}
      />
    );
  if (!list.length)
    return (
      <EmptyState
        title="No skills found"
        line={installedOnly ? `No skills are installed in ${engineName} yet.` : "Try other words."}
      />
    );
  // Grouped by where the skills come from, each group under its repository's logo and link.
  const groups = new Map<string, SkillEntry[]>();
  for (const entry of list) {
    const key = entry.repo ?? "";
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return (
    <>
      <div className="grid gap-7">
        {[...groups].map(([repo, skills]) => {
          const repoLink = repo ? `https://github.com/${repo}` : null;
          const maker = pluginMaker({ link: repoLink });
          return (
            <section
              key={repo || "local"}
              className="grid gap-2"
              aria-label={repo || "Your skills"}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <MakerLogo maker={maker} name={repo || "Skills"} size="sm" />
                <SectionHeading
                  title={repo || "Your skills"}
                  as="h3"
                  count={skills.length}
                  action={
                    repoLink
                      ? {
                          label: `Open ${repo} on GitHub`,
                          icon: ExternalLink,
                          onSelect: () => openExternalLink(repoLink),
                        }
                      : undefined
                  }
                />
              </div>
              <CatalogGrid label={repo || "Your skills"}>
                {skills.map((entry) => {
                  const here = inEngine(entry, target);
                  const removable = Boolean(entry.row?.managed && !entry.row.readonly);
                  const link = entry.link;
                  return (
                    <CatalogCard
                      key={entry.key}
                      logo={<MakerLogo maker={maker} name={entry.name} />}
                      title={entry.name}
                      maker={maker.name}
                      description={entry.description}
                      source={
                        link
                          ? {
                              label: sourceLabel(link),
                              href: link,
                              onOpen: () => openExternalLink(link),
                            }
                          : undefined
                      }
                      detail={
                        entry.installs
                          ? `${installsFormat.format(entry.installs)} installs`
                          : undefined
                      }
                      action={
                        here ? (
                          <CatalogDone />
                        ) : entry.row?.readonly ? undefined : (
                          <Button
                            icon={Download}
                            aria-label={`Install ${entry.name}`}
                            loading={busy === entry.key}
                            disabled={busy !== null}
                            onClick={() => void install(entry)}
                          >
                            Install
                          </Button>
                        )
                      }
                      menu={
                        link || (here && removable) ? (
                          <>
                            {link ? (
                              <MenuItem
                                icon={ExternalLink}
                                label="Open its page"
                                onSelect={() => openExternalLink(link)}
                              />
                            ) : null}
                            {here && removable ? (
                              <MenuItem
                                icon={Trash2}
                                label={`Remove from ${engineName}`}
                                danger
                                onSelect={() => void remove(entry)}
                              />
                            ) : null}
                          </>
                        ) : undefined
                      }
                    />
                  );
                })}
              </CatalogGrid>
            </section>
          );
        })}
      </div>
      {dialog}
    </>
  );
}
