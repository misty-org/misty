/**
 * Explore › Updates: everything with a newer version, in one place. The Space's apps whose
 * pin moved on (a mod updates them), and the skills whose repository changed since they were
 * installed (skills hub's own check). Plugins update through their engine's own CLI, which keeps
 * them current itself, so they don't show here.
 */
import { useEffect, useState } from "react";
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
import { useAppUpdates } from "@/features/spaces/apps/appUpdates";
import {
  catalogLogoUrl,
  type AppSource,
  type CatalogApp,
} from "@/features/spaces/apps/thirdPartyApps";
import { MakerTile, pluginMaker } from "./PluginMaker";

const failureText = (reason: unknown, fallback: string) =>
  reason instanceof Error && reason.message ? reason.message : fallback;

/** The installed skills that have an update, from the hub's last check (it caches the answer). */
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

export function UpdatesSection({ spaceId, canManage }: { spaceId: string; canManage: boolean }) {
  const apps = useAppUpdates(spaceId);
  const skills = useSkillUpdates();
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

  const updateApp = (app: CatalogApp, source?: AppSource) =>
    run(
      `app:${app.id}`,
      () => apps.install(app.id, app.version, app.permissions, source),
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

  const loading = !apps.loaded || skills.rows === null;
  const appRows = canManage ? apps.updates : [];
  const skillRows = skills.rows ?? [];
  const count = appRows.length + skillRows.length;

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
            }}
          >
            Update all
          </Button>
        ) : undefined
      }
    >
      {appRows.map(({ app, from, source }) => (
        <ShelfItem
          key={`app:${app.id}`}
          logo={<AppLogoImage src={catalogLogoUrl(app)} name={app.name} size="tile" />}
          title={app.name}
          line={`App · ${from} → ${app.version}`}
          action={
            <Button
              variant="get"
              size="sm"
              disabled={busy.has(`app:${app.id}`)}
              onClick={() => void updateApp(app, source)}
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
          line={`Skill · ${skill.repoOwner ?? ""}${skill.repoName ? `/${skill.repoName}` : ""}`}
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
    </Shelf>
  );
}
