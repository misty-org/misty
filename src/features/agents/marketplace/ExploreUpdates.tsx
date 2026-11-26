import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { updateCli, versionText, type CliVersionStatus } from "@/features/engine-config/clis";
import { skillsHubApi, type SkillTargetId } from "@/features/engine-config/skills";
import { useSpeechModels } from "@/features/voice";
import {
  AppLogoImage,
  Button,
  EmptyState,
  ProgressPill,
  ErrorState,
  notify,
  Shelf,
  ShelfItem,
  ShelfSkeleton,
} from "@misty/ui";
import type { CatalogEngine } from "./engine_catalog";
import { EngineTile } from "./ExploreEngines";
import { pillProgress } from "./ExploreSpeechParts";
import { exploreApps, type ExploreCatalogApp } from "./explore_apps";
import { failureText } from "./explore_index";
import { installPlugin, installSkill, useReadyEngines } from "./explore_installs";
import { ActionButton, askToRun, ListingLogo } from "./ListingRows";
import type { PluginEntry } from "@/native/registry";
import { useBarAction, useExploreNav } from "./explore_view";
import { MakerTile, pluginMaker } from "./PluginMaker";
import {
  appProgress,
  useAppUpdates,
  useDownloads,
  useEngineUpdates,
  usePluginUpdates,
  useSkillUpdates,
  useSpeechUpdates,
  type SkillUpdate,
  type SpeechEntry,
} from "./explore_updates";

function engineLine(status: CliVersionStatus) {
  const from = status.localVersion ? versionText(status.localVersion) : "the version here";
  const to = status.latestVersion ? versionText(status.latestVersion) : "the latest";
  return `From ${from} to ${to}`;
}

export function MyAppsPage({ spaceId }: { spaceId: string }) {
  const nav = useExploreNav();
  const { apps, rows: appRows } = useAppUpdates(spaceId);
  const downloads = useDownloads(spaceId);
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
        title="My apps couldn't load"
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
  if (loading && !apps.error && !skills.error) return <ShelfSkeleton label="My apps" items={3} />;
  const downloading = new Set(downloads.apps.map((app) => app.id));
  const updating = new Set(appRows.map(({ app }) => app.id));
  const here = apps.listed.filter(
    (app) =>
      apps.versionOf(app.id) !== undefined && !downloading.has(app.id) && !updating.has(app.id),
  );
  if (!count && !downloads.apps.length && !downloads.speech.length && !here.length)
    return <EmptyState inline title="No apps yet" line="What you get in Explore shows up here." />;
  const appLogo = (app: ExploreCatalogApp) => (
    <AppLogoImage
      src={exploreApps().catalogLogoUrl(app)}
      name={app.name}
      size="tile"
      render={app.icon_render}
    />
  );
  const updateButton = (
    key: string,
    onClick: () => void,
    progress?: { value?: number },
    name?: string,
  ) =>
    progress ? (
      <ProgressPill
        value={progress.value}
        label={name ? `Downloading ${name}` : "Downloading"}
        size="sm"
        widthOf={["Update"]}
      />
    ) : (
      <Button
        variant="get"
        size="sm"
        widthOf={["Update"]}
        disabled={busy.has(key)}
        onClick={onClick}
      >
        Update
      </Button>
    );
  return (
    <>
      {downloads.apps.length || downloads.speech.length ? (
        <Shelf title="Downloading">
          {downloads.apps.map((app) => (
            <ShelfItem
              key={`app:${app.id}`}
              logo={appLogo(app)}
              title={app.name}
              line={apps.versionOf(app.id) === undefined ? app.description : `To ${app.version}`}
              action={
                <ActionButton
                  action={{
                    label: "Get",
                    variant: "get",
                    progress: appProgress(apps.downloadOf(app.id)),
                    onClick: () => undefined,
                  }}
                  label={app.name}
                />
              }
              onOpen={() => nav.open({ kind: "apps", id: app.id })}
            />
          ))}
          {downloads.speech.map((entry) => (
            <ShelfItem
              key={`speech:${entry.id}`}
              logo={
                <MakerTile
                  maker={pluginMaker({ author: entry.maker, link: entry.source })}
                  name={entry.name}
                />
              }
              title={entry.name}
              line={entry.description}
              action={
                <ActionButton
                  action={{
                    label: "Get",
                    variant: "get",
                    progress: pillProgress(downloads.stateOf(entry).coming, true),
                    onClick: () => undefined,
                  }}
                  label={entry.name}
                />
              }
              onOpen={() => nav.open({ kind: "hearing", id: entry.id })}
            />
          ))}
        </Shelf>
      ) : null}
      {appRows.length ? (
        <Shelf title="App updates">
          {appRows.map(({ app, from }) => (
            <ShelfItem
              key={app.id}
              logo={appLogo(app)}
              title={app.name}
              line={`From ${from} to ${app.version}`}
              action={updateButton(
                `app:${app.id}`,
                () => void updateApp(app),
                appProgress(apps.downloadOf(app.id)),
                app.name,
              )}
            />
          ))}
        </Shelf>
      ) : null}
      {skillRows.length ? (
        <Shelf title="Skill updates">
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
        <Shelf title="Engine updates">
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
        <Shelf title="Plugin updates">
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
        <Shelf title="Speech updates">
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
                line="A newer version"
                action={updateButton(
                  `speech:${entry.id}`,
                  () => void updateSpeech(entry),
                  pillProgress(coming, false),
                  entry.name,
                )}
              />
            );
          })}
        </Shelf>
      ) : null}
      {here.length ? (
        <Shelf title="On this computer">
          {here.map((app) => (
            <ShelfItem
              key={app.id}
              logo={appLogo(app)}
              title={app.name}
              line={app.description ?? `By ${app.maker}`}
              action={
                <ActionButton
                  action={{ label: "Open", variant: "secondary", onClick: () => apps.open(app.id) }}
                  label={app.name}
                />
              }
              onOpen={() => nav.open({ kind: "apps", id: app.id })}
            />
          ))}
        </Shelf>
      ) : null}
    </>
  );
}
