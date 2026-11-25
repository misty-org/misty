import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import {
  hasCliUpdate,
  updateCli,
  useCliStatuses,
  versionText,
  type CliVersionStatus,
} from "@/features/engine-config/clis";
import { skillsHubApi, type SkillRow, type SkillTargetId } from "@/features/engine-config/skills";
import { useSpeechModels, type HearingModelView } from "@/features/voice";
import {
  AppLogoImage,
  Button,
  EmptyState,
  ErrorState,
  notify,
  Shelf,
  ShelfItem,
  ShelfSkeleton,
} from "@misty/ui";
import { useRegistryEngineIds, useRegistryEngines, type CatalogEngine } from "./engine_catalog";
import { EngineTile } from "./ExploreEngines";
import { progressLine } from "./ExploreSpeechParts";
import { exploreApps, type ExploreCatalogApp } from "./explore_apps";
import { failureText } from "./explore_index";
import {
  installPlugin,
  installSkill,
  useInstallRecords,
  useReadyEngines,
} from "./explore_installs";
import { askToRun, ListingLogo } from "./ListingRows";
import {
  registryShards,
  useRegistry,
  type ListingEntry,
  type PluginEntry,
} from "@/native/registry";
import { useBarAction, useExploreNav } from "./explore_view";
import { MakerTile, pluginMaker } from "./PluginMaker";

type SpeechEntry = HearingModelView;

type SkillUpdate = SkillRow & { entry?: ListingEntry };

async function registryUpdates(rows: SkillRow[]): Promise<SkillUpdate[]> {
  const pinned = rows.filter((row) => row.registryId && row.registryCategory && row.bundleSha256);
  const categories = [...new Set(pinned.map((row) => row.registryCategory as string))].filter(
    (category) => useRegistry.getState().listings.skills?.categories[category],
  );
  const shards = await Promise.all(
    categories.map((category) => registryShards.category("skills", category)),
  );
  const listed = new Map(
    shards.flatMap((shard) => shard.items).map((entry) => [entry.id, entry] as const),
  );
  return pinned.flatMap((row) => {
    const entry = listed.get(row.registryId as string);
    return entry?.bundle && entry.bundle.sha256 !== row.bundleSha256 ? [{ ...row, entry }] : [];
  });
}

function useSkillUpdates() {
  const [rows, setRows] = useState<SkillUpdate[] | null>(null);
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    skillsHubApi
      .installed()
      .then(async (installed) => {
        const fromGitHub = installed.skills.filter((row) => !row.registryId);
        const [github, registry] = await Promise.all([
          fromGitHub.length
            ? skillsHubApi.updates()
            : Promise.resolve({ updates: {} as Record<string, unknown> }),
          registryUpdates(installed.skills),
        ]);
        return [...fromGitHub.filter((row) => github.updates[row.id]), ...registry];
      })
      .then(
        (found) => {
          if (!live) return;
          setRows(found);
          setError("");
        },
        (reason: unknown) => live && setError(failureText(reason, "Skill updates couldn't load.")),
      );
    return () => {
      live = false;
    };
  }, [round]);
  return { rows, error, reload: () => setRound((value) => value + 1) };
}

function useEngineUpdates(options: { probe?: boolean } = {}) {
  const engines = useRegistryEngines();
  const { statuses, settled } = useCliStatuses(useRegistryEngineIds(), options);
  const rows = engines
    .filter((engine) => hasCliUpdate(statuses[engine.id]))
    .map((engine) => ({ engine, status: statuses[engine.id] as CliVersionStatus }));
  return { rows, settled };
}

function useSpeechUpdates(): SpeechEntry[] | null {
  const catalog = useSpeechModels((state) => state.catalog);
  useEffect(() => {
    if (!useSpeechModels.getState().catalog) void useSpeechModels.getState().load();
  }, []);
  if (!catalog) return null;
  return catalog.hearing.filter((entry) => entry.outdated);
}

function useAppUpdates(spaceId: string) {
  const apps = exploreApps().useExploreInstalledApps(spaceId);
  const rows = apps.listed.flatMap((app) => {
    const from = apps.versionOf(app.id);
    return from !== undefined && from !== app.version ? [{ app, from }] : [];
  });
  return { apps, rows };
}

function usePluginUpdates() {
  const records = useInstallRecords();
  const [rows, setRows] = useState<PluginEntry[]>([]);
  const held = (records.data ?? []).filter((one) => one.kind === "plugins");
  const key = held.map((one) => `${one.id}:${one.digest}`).join(",");
  useEffect(() => {
    if (!key) {
      setRows([]);
      return;
    }
    let live = true;
    const digests = new Map(key.split(",").map((pair) => pair.split(":") as [string, string]));
    registryShards.find("plugins", [...digests.keys()]).then(
      (entries) => {
        if (live)
          setRows(
            entries.filter(
              (entry) => entry.bundle && entry.bundle.sha256 !== digests.get(entry.id),
            ),
          );
      },
      () => live && setRows([]),
    );
    return () => {
      live = false;
    };
  }, [key]);
  return { rows, reload: () => void records.reload() };
}

export function useUpdateCount(spaceId: string) {
  const apps = useAppUpdates(spaceId).rows.length;
  const skills = useSkillUpdates().rows?.length ?? 0;
  const engines = useEngineUpdates({ probe: false }).rows.length;
  const speech = useSpeechUpdates()?.length ?? 0;
  const plugins = usePluginUpdates().rows.length;
  return apps + skills + engines + speech + plugins;
}

function engineLine(status: CliVersionStatus) {
  const from = status.localVersion ? versionText(status.localVersion) : "the version here";
  const to = status.latestVersion ? versionText(status.latestVersion) : "the latest";
  return `From ${from} to ${to}`;
}

export function UpdatesPage({ spaceId }: { spaceId: string }) {
  const nav = useExploreNav();
  const { apps, rows: appRows } = useAppUpdates(spaceId);
  const skills = useSkillUpdates();
  const plugins = usePluginUpdates();
  const readyEngines = useReadyEngines();
  const engines = useEngineUpdates();
  const speech = useSpeechUpdates();
  const speechError = useSpeechModels((state) => state.error);
  const speechProgress = useSpeechModels((state) => state.progress);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  const run = async (key: string, work: () => Promise<unknown>, done: string, failed: string) => {
    setBusy((current) => new Set(current).add(key));
    try {
      await work();
      notify({ message: done });
    } catch (reason) {
      const code = (reason as { code?: string }).code;
      notify({
        message:
          code === "conflict"
            ? `${failed}: it has changes of its own.`
            : failureText(reason, `${failed}.`),
        tone: "error",
      });
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };
  const asksMore = (app: ExploreCatalogApp) =>
    app.permissions.some((permission) => !apps.approvedOf(app.id).includes(permission));
  const updateApp = (app: ExploreCatalogApp) =>
    asksMore(app)
      ? nav.open({ kind: "apps", id: app.id })
      : run(
          `app:${app.id}`,
          () => apps.install(app.id, app.version, app.permissions),
          `${app.name} is up to date.`,
          `${app.name} couldn't be updated`,
        );
  const updateSkill = (skill: SkillUpdate) =>
    run(
      `skill:${skill.id}`,
      async () => {
        if (skill.entry) {
          await installSkill(skill.entry, skill.targets);
          skills.reload();
          return;
        }
        if (!skill.repoOwner || !skill.repoName) return;
        await skillsHubApi.install(
          {
            key: skill.key,
            name: skill.name,
            description: skill.description,
            directory: skill.sourceDirectory || skill.directory,
            readmeUrl: skill.readmeUrl,
            repoOwner: skill.repoOwner,
            repoName: skill.repoName,
            repoBranch: skill.repoBranch ?? "main",
          },
          (skill.targets.length > 0 ? skill.targets : ["claude", "codex"]) as SkillTargetId[],
          false,
        );
        skills.reload();
      },
      `${skill.name} is up to date.`,
      `${skill.name} couldn't be updated`,
    );
  const updateEngine = (engine: CatalogEngine) =>
    run(
      `engine:${engine.id}`,
      () => updateCli(engine.id, `explore-${engine.id}-${Date.now()}`),
      `${engine.name} is up to date.`,
      `${engine.name} couldn't be updated`,
    );
  const updatePlugin = (entry: PluginEntry) =>
    run(
      `plugin:${entry.id}`,
      async () => {
        await installPlugin(entry, readyEngines, askToRun);
        plugins.reload();
      },
      `${entry.name} is up to date.`,
      `${entry.name} couldn't be updated`,
    );
  const updateSpeech = (entry: SpeechEntry) =>
    run(
      `speech:${entry.id}`,
      async () => {
        await useSpeechModels.getState().install(entry.id);
        const failure = useSpeechModels.getState().failures[entry.id];
        if (failure) throw new Error(failure);
      },
      `${entry.name} is up to date.`,
      `${entry.name} couldn't be updated`,
    );

  const skillRows = skills.rows ?? [];
  const pluginRows = plugins.rows;
  const engineRows = engines.rows;
  const speechRows = speech ?? [];
  const count =
    appRows.length + skillRows.length + pluginRows.length + engineRows.length + speechRows.length;
  useBarAction(
    count > 1
      ? {
          label: "Update all",
          variant: "get",
          disabled: busy.size > 0,
          onClick: () => {
            for (const { app } of appRows) if (!asksMore(app)) void updateApp(app);
            for (const skill of skillRows) void updateSkill(skill);
            for (const plugin of pluginRows) void updatePlugin(plugin);
            void (async () => {
              for (const { engine } of engineRows) await updateEngine(engine);
            })();
            const packages = new Set<string>();
            for (const entry of speechRows) {
              if (packages.has(entry.packageKey)) continue;
              packages.add(entry.packageKey);
              void updateSpeech(entry);
            }
          },
        }
      : null,
  );

  const loading =
    !apps.loaded ||
    skills.rows === null ||
    (speech === null && !speechError) ||
    (!engines.settled && !engines.rows.length);
  if (apps.error && skills.error)
    return (
      <ErrorState
        inline
        title="Updates couldn't load"
        line={apps.error}
        action={{
          label: "Try again",
          icon: RefreshCw,
          variant: "secondary",
          onClick: () => {
            apps.reload();
            skills.reload();
          },
        }}
      />
    );
  if (loading && !apps.error && !skills.error) return <ShelfSkeleton label="Updates" items={3} />;
  if (!count)
    return <EmptyState inline title="Everything is up to date" line="New versions show up here." />;
  const updateButton = (key: string, onClick: () => void, disabled = false) => (
    <Button variant="get" size="sm" disabled={busy.has(key) || disabled} onClick={onClick}>
      Update
    </Button>
  );
  return (
    <>
      {appRows.length ? (
        <Shelf title="Apps">
          {appRows.map(({ app, from }) => (
            <ShelfItem
              key={app.id}
              logo={
                <AppLogoImage
                  src={exploreApps().catalogLogoUrl(app)}
                  name={app.name}
                  size="tile"
                  render={app.icon_render}
                />
              }
              title={app.name}
              line={`From ${from} to ${app.version}`}
              action={updateButton(`app:${app.id}`, () => void updateApp(app))}
            />
          ))}
        </Shelf>
      ) : null}
      {skillRows.length ? (
        <Shelf title="Skills">
          {skillRows.map((skill) => (
            <ShelfItem
              key={skill.id}
              logo={
                <MakerTile
                  maker={pluginMaker({
                    link:
                      skill.repoOwner && skill.repoName
                        ? `https://github.com/${skill.repoOwner}/${skill.repoName}`
                        : null,
                  })}
                  name={skill.name}
                />
              }
              title={skill.name}
              line={
                skill.repoOwner && skill.repoName
                  ? `From ${skill.repoOwner}/${skill.repoName}`
                  : skill.description
              }
              action={updateButton(`skill:${skill.id}`, () => void updateSkill(skill))}
            />
          ))}
        </Shelf>
      ) : null}
      {engineRows.length ? (
        <Shelf title="Engines">
          {engineRows.map(({ engine, status }) => (
            <ShelfItem
              key={engine.id}
              logo={<EngineTile engine={engine} />}
              title={engine.name}
              line={busy.has(`engine:${engine.id}`) ? "Updating" : engineLine(status)}
              action={updateButton(`engine:${engine.id}`, () => void updateEngine(engine))}
            />
          ))}
        </Shelf>
      ) : null}
      {pluginRows.length ? (
        <Shelf title="Plugins">
          {pluginRows.map((entry) => (
            <ShelfItem
              key={entry.id}
              logo={<ListingLogo entry={entry} />}
              title={entry.name}
              line={entry.description}
              action={updateButton(`plugin:${entry.id}`, () => void updatePlugin(entry))}
            />
          ))}
        </Shelf>
      ) : null}
      {speechRows.length ? (
        <Shelf title="Speech">
          {speechRows.map((entry) => {
            const coming = speechProgress[entry.id] ?? speechProgress[entry.packageKey];
            return (
              <ShelfItem
                key={entry.id}
                logo={
                  <MakerTile
                    maker={pluginMaker({ author: entry.maker, link: entry.source })}
                    name={entry.name}
                  />
                }
                title={entry.name}
                line={coming ? progressLine(coming) : "A newer version"}
                action={updateButton(
                  `speech:${entry.id}`,
                  () => void updateSpeech(entry),
                  Boolean(coming),
                )}
              />
            );
          })}
        </Shelf>
      ) : null}
    </>
  );
}
