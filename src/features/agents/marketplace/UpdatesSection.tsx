import { useEffect, useState } from "react";
import {
  hasCliUpdate,
  updateCli,
  useCliStatuses,
  versionText,
  type CliVersionStatus,
} from "@/features/engine-config/clis";
import { useSpeechModels } from "@/features/voice";
import {
  AppLogoImage,
  Button,
  EmptyState,
  ErrorState,
  Shelf,
  ShelfItem,
  ShelfSkeleton,
  notify,
} from "@misty/ui";
import { skillsHubApi, type SkillRow, type SkillTargetId } from "@/features/engine-config/skills";
import { exploreApps, type ExploreCatalogApp } from "./explore_apps";
import { useRegistryEngineIds, useRegistryEngines, type CatalogEngine } from "./engine_catalog";
import { EngineTile } from "./EnginesSection";
import { MakerTile, pluginMaker } from "./PluginMaker";
import { progressLine, type SpeechEntry } from "./SpeechSection";

const failureText = (reason: unknown, fallback: string) =>
  reason instanceof Error && reason.message ? reason.message : fallback;

export function useSkillUpdates() {
  const [rows, setRows] = useState<SkillRow[] | null>(null);
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    Promise.all([skillsHubApi.installed(), skillsHubApi.updates()]).then(
      ([installed, result]) => {
        if (!live) return;
        setRows(installed.skills.filter((skill) => result.updates[skill.id]));
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

export function useEngineUpdates(options: { probe?: boolean } = {}) {
  const engines = useRegistryEngines();
  const { statuses, settled } = useCliStatuses(useRegistryEngineIds(), options);
  const rows = engines
    .filter((engine) => hasCliUpdate(statuses[engine.id]))
    .map((engine) => ({ engine, status: statuses[engine.id] as CliVersionStatus }));
  return { rows, settled };
}

function engineLine(status: CliVersionStatus) {
  const from = status.localVersion ? versionText(status.localVersion) : "the version here";
  const to = status.latestVersion ? versionText(status.latestVersion) : "the latest";
  return `Engine, from ${from} to ${to}`;
}

export function useSpeechUpdates(): SpeechEntry[] | null {
  const catalog = useSpeechModels((state) => state.catalog);
  useEffect(() => {
    if (!useSpeechModels.getState().catalog) void useSpeechModels.getState().load();
  }, []);
  if (!catalog) return null;
  return [...catalog.hearing, ...catalog.voices].filter((entry) => entry.outdated);
}

export function UpdatesSection({ spaceId, canManage }: { spaceId: string; canManage: boolean }) {
  const { useAppUpdates, catalogLogoUrl } = exploreApps();
  const apps = useAppUpdates(spaceId);
  const skills = useSkillUpdates();
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
            ? `${failed}: it has changes of its own. Update it from Skills to choose.`
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

  const updateApp = (app: ExploreCatalogApp) =>
    run(
      `app:${app.id}`,
      () => apps.install(app.id, app.version, app.permissions),
      `${app.name} is up to date.`,
      `${app.name} couldn't be updated`,
    );
  const updateSkill = (skill: SkillRow) =>
    run(
      `skill:${skill.id}`,
      async () => {
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

  const loading =
    !apps.loaded ||
    skills.rows === null ||
    (speech === null && !speechError) ||
    (!engines.settled && !engines.rows.length);
  const appRows = canManage ? apps.updates : [];
  const skillRows = skills.rows ?? [];
  const engineRows = engines.rows;
  const speechRows = speech ?? [];
  const count = appRows.length + skillRows.length + engineRows.length + speechRows.length;

  if (apps.error && skills.error) {
    return (
      <ErrorState
        inline
        title="Updates couldn't load"
        line={apps.error}
        action={{
          label: "Try again",
          variant: "secondary",
          onClick: () => {
            apps.reload();
            skills.reload();
          },
        }}
      />
    );
  }
  if (loading && !apps.error && !skills.error) return <ShelfSkeleton label="Updates" items={2} />;
  if (!count) {
    return <EmptyState title="Everything is up to date" line="New versions show up here." />;
  }
  return (
    <Shelf
      title="Updates"
      columns={1}
      action={
        count > 1 ? (
          <Button
            variant="get-filled"
            size="sm"
            disabled={busy.size > 0}
            onClick={() => {
              for (const { app } of appRows) void updateApp(app);
              for (const skill of skillRows) void updateSkill(skill);
              void (async () => {
                for (const { engine } of engineRows) await updateEngine(engine);
              })();
              const packages = new Set<string>();
              for (const entry of speechRows) {
                if (packages.has(entry.packageKey)) continue;
                packages.add(entry.packageKey);
                void updateSpeech(entry);
              }
            }}
          >
            Update all
          </Button>
        ) : undefined
      }
    >
      {appRows.map(({ app, from }) => (
        <ShelfItem
          key={`app:${app.id}`}
          logo={
            <AppLogoImage
              src={catalogLogoUrl(app)}
              name={app.name}
              size="tile"
              render={app.icon_render}
            />
          }
          title={app.name}
          line={`App, from ${from} to ${app.version}`}
          action={
            <Button
              variant="get"
              size="sm"
              disabled={busy.has(`app:${app.id}`)}
              onClick={() => void updateApp(app)}
            >
              Update
            </Button>
          }
        />
      ))}
      {skillRows.map((skill) => (
        <ShelfItem
          key={`skill:${skill.id}`}
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
            skill.repoOwner || skill.repoName
              ? `Skill from ${skill.repoOwner ?? ""}${skill.repoName ? `/${skill.repoName}` : ""}`
              : "Skill"
          }
          action={
            <Button
              variant="get"
              size="sm"
              disabled={busy.has(`skill:${skill.id}`)}
              onClick={() => void updateSkill(skill)}
            >
              Update
            </Button>
          }
        />
      ))}
      {engineRows.map(({ engine, status }) => (
        <ShelfItem
          key={`engine:${engine.id}`}
          logo={<EngineTile engine={engine} />}
          title={engine.name}
          line={busy.has(`engine:${engine.id}`) ? "Updating" : engineLine(status)}
          action={
            <Button
              variant="get"
              size="sm"
              disabled={busy.has(`engine:${engine.id}`)}
              onClick={() => void updateEngine(engine)}
            >
              Update
            </Button>
          }
        />
      ))}
      {speechRows.map((entry) => {
        const coming = speechProgress[entry.id] ?? speechProgress[entry.packageKey];
        const hearing = "description" in entry;
        return (
          <ShelfItem
            key={`speech:${entry.id}`}
            logo={
              hearing ? (
                <MakerTile
                  maker={pluginMaker({ author: entry.maker, link: entry.source })}
                  name={entry.name}
                />
              ) : undefined
            }
            title={entry.name}
            line={
              coming
                ? progressLine(coming)
                : hearing
                  ? "Hearing model, a newer version"
                  : "Voice, a newer version"
            }
            action={
              <Button
                variant="get"
                size="sm"
                disabled={busy.has(`speech:${entry.id}`) || Boolean(coming)}
                onClick={() => void updateSpeech(entry)}
              >
                Update
              </Button>
            }
          />
        );
      })}
    </Shelf>
  );
}
