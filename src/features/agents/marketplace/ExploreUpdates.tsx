import { RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { updateCli, versionText, type CliVersionStatus } from "@/features/engine-config/clis";
import { skillsHubApi, type SkillTargetId } from "@/features/engine-config/skills";
import { useSpeechModels } from "@/features/voice";
import {
  Button,
  ErrorState,
  notify,
  ProgressPill,
  StoreCard,
  StoreCards,
  StoreSection,
  StoreSkeleton,
  StoreTiles,
} from "@misty/ui";
import { type ListingEntry, type PluginEntry } from "@/native/registry";
import { type CatalogEngine } from "./engine_catalog";
import { AppItem, AppLogo } from "./ExploreApps";
import { EngineTile } from "./ExploreEngines";
import { pillProgress } from "./ExploreSpeechParts";
import type { ExploreCatalogApp } from "./explore_apps";
import { failureText } from "./explore_index";
import { installPlugin, installSkill, useReadyEngines } from "./explore_installs";
import { useExploreNav } from "./explore_view";
import { askToRun, ListingLogo } from "./ListingRows";
import { MakerTile, pluginMaker } from "./PluginMaker";
import {
  HeldEngines,
  HeldSkillsAndPlugins,
  HeldSpeech,
  NothingYet,
  SkillLogo,
  UsedTemplates,
} from "./ExploreHeld";
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

export function InstalledPage({ spaceId }: { spaceId: string }) {
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
  const updateAll = () => {
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
  };

  const loading =
    !apps.loaded ||
    skills.rows === null ||
    (speech === null && !speechError) ||
    (!engines.settled && !engines.rows.length);
  if (apps.error && skills.error)
    return (
      <ErrorState
        inline
        title="Installed couldn't load"
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
  if (loading && !apps.error && !skills.error)
    return (
      <>
        <StoreSkeleton label="Installed" look="cards" items={2} />
        <StoreSkeleton label="Installed" look="tiles" items={4} />
      </>
    );
  const downloading = new Set(downloads.apps.map((app) => app.id));
  const updating = new Set(appRows.map(({ app }) => app.id));
  const here = apps.listed.filter(
    (app) =>
      apps.versionOf(app.id) !== undefined && !downloading.has(app.id) && !updating.has(app.id),
  );
  const updateButton = (
    key: string,
    onClick: () => void,
    progress?: { value?: number },
    name?: string,
  ): ReactNode =>
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
        <StoreSection title="Downloading">
          <StoreCards label="Downloading">
            {downloads.apps.map((app) => (
              <StoreCard
                key={`app:${app.id}`}
                logo={<AppLogo app={app} size="item" />}
                title={app.name}
                line={apps.versionOf(app.id) === undefined ? "App" : `App, to ${app.version}`}
                action={
                  <ProgressPill
                    value={appProgress(apps.downloadOf(app.id))?.value}
                    label={`Downloading ${app.name}`}
                    size="sm"
                    widthOf={["Get", "Update"]}
                  />
                }
                onOpen={() => nav.open({ kind: "apps", id: app.id })}
              />
            ))}
            {downloads.speech.map((entry) => (
              <StoreCard
                key={`speech:${entry.id}`}
                logo={
                  <MakerTile
                    maker={pluginMaker({ author: entry.maker, link: entry.source })}
                    name={entry.name}
                  />
                }
                title={entry.name}
                line="Hearing model"
                action={
                  <ProgressPill
                    value={pillProgress(downloads.stateOf(entry).coming, true)?.value}
                    label={`Downloading ${entry.name}`}
                    size="sm"
                    widthOf={["Get", "Update"]}
                  />
                }
                onOpen={() => nav.open({ kind: "hearing", id: entry.id })}
              />
            ))}
          </StoreCards>
        </StoreSection>
      ) : null}
      {count ? (
        <StoreSection
          title="Updates"
          detail={`${count} ready`}
          action={
            count > 1 ? (
              <Button size="sm" disabled={busy.size > 0} onClick={updateAll}>
                Update all
              </Button>
            ) : undefined
          }
        >
          <StoreCards label="Updates">
            {appRows.map(({ app, from }) => (
              <StoreCard
                key={`app:${app.id}`}
                logo={<AppLogo app={app} size="item" />}
                title={app.name}
                line={`From ${from} to ${app.version}`}
                action={updateButton(
                  `app:${app.id}`,
                  () => void updateApp(app),
                  appProgress(apps.downloadOf(app.id)),
                  app.name,
                )}
                onOpen={() => nav.open({ kind: "apps", id: app.id })}
              />
            ))}
            {engineRows.map(({ engine, status }) => (
              <StoreCard
                key={`engine:${engine.id}`}
                logo={<EngineTile engine={engine} />}
                title={engine.name}
                line={busy.has(`engine:${engine.id}`) ? "Updating" : engineLine(status)}
                state={busy.has(`engine:${engine.id}`) ? "waiting" : undefined}
                action={updateButton(`engine:${engine.id}`, () => void updateEngine(engine))}
                onOpen={() => nav.open({ kind: "engines", id: engine.id })}
              />
            ))}
            {skillRows.map((skill) => (
              <StoreCard
                key={`skill:${skill.id}`}
                logo={<SkillLogo skill={skill} />}
                title={skill.name}
                line={
                  skill.repoOwner && skill.repoName
                    ? `From ${skill.repoOwner}/${skill.repoName}`
                    : skill.description
                }
                action={updateButton(`skill:${skill.id}`, () => void updateSkill(skill))}
                onOpen={
                  skill.entry
                    ? () => nav.open({ kind: "skills", entry: skill.entry as ListingEntry })
                    : undefined
                }
              />
            ))}
            {pluginRows.map((entry) => (
              <StoreCard
                key={`plugin:${entry.id}`}
                logo={<ListingLogo entry={entry} />}
                title={entry.name}
                line="A newer version"
                action={updateButton(`plugin:${entry.id}`, () => void updatePlugin(entry))}
                onOpen={() => nav.open({ kind: "plugins", entry })}
              />
            ))}
            {speechRows.map((entry) => (
              <StoreCard
                key={`speech:${entry.id}`}
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
                  pillProgress(speechProgress[entry.id] ?? speechProgress[entry.packageKey], false),
                  entry.name,
                )}
                onOpen={() => nav.open({ kind: "hearing", id: entry.id })}
              />
            ))}
          </StoreCards>
        </StoreSection>
      ) : null}
      {here.length ? (
        <StoreSection title="Apps" detail="On this computer">
          <StoreTiles label="Apps on this computer">
            {here.map((app) => (
              <AppItem key={app.id} apps={apps} app={app} />
            ))}
          </StoreTiles>
        </StoreSection>
      ) : null}
      <UsedTemplates />
      <HeldSkillsAndPlugins />
      <HeldEngines />
      <HeldSpeech />
      {!count && !downloads.apps.length && !downloads.speech.length && !here.length ? (
        <NothingYet />
      ) : null}
    </>
  );
}
