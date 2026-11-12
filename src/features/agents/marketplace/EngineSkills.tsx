import { Download, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  skillsHubApi,
  type DiscoveredSkill,
  type SkillRow,
  type SkillTargetId,
} from "@/features/engine-config/skills";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  Button,
  EmptyState,
  ListRow,
  ListRowSkeleton,
  MenuItem,
  notify,
  useConfirmDelete,
} from "@/shared/ui";
import { failureText } from "./api";

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
  const [installed, setInstalled] = useState<SkillRow[] | null>(null);
  const [found, setFound] = useState<DiscoveredSkill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Bumped by Try again, which lists the skills anew. */
  const [attempt, setAttempt] = useState(0);
  const { confirm, dialog } = useConfirmDelete();

  const loadInstalled = useCallback(async () => {
    const result = await skillsHubApi.installed();
    setInstalled(result.skills);
  }, []);

  useEffect(() => {
    let live = true;
    setError(null);
    const term = query.trim();
    const timer = window.setTimeout(
      () => {
        const request = term
          ? skillsHubApi.search(term, 0, 50).then((result) => result.skills)
          : skillsHubApi.discover().then((result) => result.skills);
        Promise.all([request, skillsHubApi.installed()]).then(
          ([skills, hub]) => {
            if (!live) return;
            setFound(skills);
            setInstalled(hub.skills);
          },
          (reason: unknown) => {
            if (!live) return;
            setFound([]);
            setInstalled((current) => current ?? []);
            setError(failureText(reason, "The skills couldn't be listed."));
          },
        );
      },
      term ? 300 : 0,
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query, attempt]);

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

  if (!list) return <ListRowSkeleton label={`${engineName} skills`} rows={10} lines={2} />;
  if (error && !list.length)
    return (
      <EmptyState
        title="The skills couldn't be listed"
        line={error}
        action={{
          label: "Try again",
          icon: RefreshCw,
          onClick: () => {
            setFound(null);
            setAttempt((count) => count + 1);
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
  return (
    <>
      <ul className="grid">
        {list.map((entry) => {
          const here = inEngine(entry, target);
          const removable = Boolean(entry.row?.managed && !entry.row.readonly);
          const details = [
            entry.description,
            entry.repo,
            entry.installs ? `${installsFormat.format(entry.installs)} installs` : "",
          ].filter(Boolean);
          return (
            <li key={entry.key} className="list-none">
              <ListRow
                label={entry.name}
                description={details.join(" · ")}
                state={here ? { kind: "done", label: "Installed" } : { kind: "none" }}
                trailing={
                  here || entry.row?.readonly ? undefined : (
                    <Button
                      size="sm"
                      icon={Download}
                      loading={busy === entry.key}
                      disabled={busy !== null}
                      onClick={() => void install(entry)}
                    >
                      Install
                    </Button>
                  )
                }
                menu={
                  entry.link || (here && removable) ? (
                    <>
                      {entry.link ? (
                        <MenuItem
                          icon={ExternalLink}
                          label="Open its page"
                          onSelect={() => openExternalLink(entry.link ?? "")}
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
            </li>
          );
        })}
      </ul>
      {dialog}
    </>
  );
}
