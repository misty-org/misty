import { useState } from "react";

import { skillsHubApi, type SkillTargetId } from "@/features/engine-config/skills";

import { registryInstalls } from "@/native/registry";

import {
  Button,
  Field,
  Input,
  Mark,
  notify,
  RowGroupLabel,
  SettingsRow,
  SettingsSection,
  Switch,
  useConfirmDelete,
} from "@misty/ui";
import type { ListingEntry, McpEntry, PluginEntry } from "@/native/registry";
import { AppManage } from "./ExploreApps";
import { EngineManage } from "./ExploreEngines";
import { SpeechManage } from "./ExploreSpeechProducts";
import {
  addPackage,
  disconnectRemote,
  makeAgentFromTemplate,
  removePackage,
  runsHere,
  useMcpHere,
  useReadyEngines,
  useInstallRecords,
  useSkillsHere,
  useTemplateAgents,
} from "./explore_installs";

import { failureText } from "./explore_index";
import { useExploreNav, type ExploreItem } from "./explore_view";

export function ExploreManage({ item, spaceId }: { item: ExploreItem; spaceId: string }) {
  if (item.kind === "apps") return <AppManage spaceId={spaceId} id={item.id} />;
  if (item.kind === "engines") return <EngineManage id={item.id} />;
  if (item.kind === "hearing") return <SpeechManage id={item.id} />;
  if (item.kind === "skills") return <SkillManage entry={item.entry} />;
  if (item.kind === "templates") return <TemplateManage entry={item.entry} />;
  if (item.kind === "plugins") return <PluginManage entry={item.entry} />;
  return <McpManage entry={item.entry} />;
}

function SkillManage({ entry }: { entry: ListingEntry }) {
  const skills = useSkillsHere();
  const nav = useExploreNav();
  const engines = useReadyEngines().filter((engine) => engine.skills);
  const { confirm, dialog } = useConfirmDelete();
  const row = skills.of(entry);
  if (!row) return null;
  const setTargets = async (targets: SkillTargetId[]) => {
    try {
      await skillsHubApi.setTargets(row.id, targets);
      await skills.reload();
    } catch (reason) {
      notify({ message: failureText(reason, `${entry.name} couldn't be changed.`), tone: "error" });
    }
  };
  return (
    <>
      <SettingsSection title={entry.name}>
        {engines.map((engine) => {
          const target = engine.skills as SkillTargetId;
          const on = row.targets.includes(target);
          return (
            <SettingsRow
              key={engine.id}
              label={engine.name}
              leading={<Mark of={`engine:${engine.id}`} label={engine.name} size={18} />}
            >
              <Switch
                checked={on}
                aria-label={`${entry.name} in ${engine.name}`}
                onCheckedChange={(next) =>
                  void setTargets(
                    next ? [...row.targets, target] : row.targets.filter((one) => one !== target),
                  )
                }
              />
            </SettingsRow>
          );
        })}
        <SettingsRow label="Remove from every engine">
          <Button
            variant="danger"
            size="sm"
            onClick={() =>
              void confirm({
                title: `Remove ${entry.name}?`,
                what: `${entry.name} leaves every engine on this computer. You can get it again here.`,
                confirmLabel: "Remove",
                onConfirm: async () => {
                  await skillsHubApi.uninstall(row.id);
                  await skills.reload();
                  nav.closeManage();
                },
              })
            }
          >
            Remove
          </Button>
        </SettingsRow>
      </SettingsSection>
      {dialog}
    </>
  );
}

function PluginManage({ entry }: { entry: PluginEntry }) {
  const records = useInstallRecords();
  const nav = useExploreNav();
  const engines = useReadyEngines();
  const { confirm, dialog } = useConfirmDelete();
  const record = records.data?.find((one) => one.kind === "plugins" && one.id === entry.id);
  if (!record) return null;
  const nameOf = (id: string) =>
    engines.find((engine) => engine.id === id || engine.skills === id)?.name ?? id;
  return (
    <>
      <SettingsSection title={entry.name}>
        {record.placed.map((one) => (
          <SettingsRow
            key={`${one.engine}:${one.how}`}
            label={nameOf(one.engine)}
            leading={<Mark of={`engine:${one.engine}`} label={nameOf(one.engine)} size={18} />}
            description={
              one.how === "plugin"
                ? "Installed as the engine's own plugin"
                : one.skills.length === 1
                  ? "Its skill, in the engine's skills"
                  : `Its ${one.skills.length} skills, in the engine's skills`
            }
          />
        ))}
        <SettingsRow label="Remove from every engine">
          <Button
            variant="danger"
            size="sm"
            onClick={() =>
              void confirm({
                title: `Remove ${entry.name}?`,
                what: `${entry.name} leaves every engine on this computer. You can get it again here.`,
                confirmLabel: "Remove",
                onConfirm: async () => {
                  await registryInstalls.removePlugin(entry.id);
                  await records.reload();
                  nav.closeManage();
                },
              })
            }
          >
            Remove
          </Button>
        </SettingsRow>
      </SettingsSection>
      {dialog}
    </>
  );
}

function TemplateManage({ entry }: { entry: ListingEntry }) {
  const made = useTemplateAgents()(entry);
  const [busy, setBusy] = useState(false);
  if (!made.length) return null;
  const again = async () => {
    setBusy(true);
    try {
      await makeAgentFromTemplate(entry);
    } catch (reason) {
      notify({
        message: failureText(reason, `${entry.name} couldn't be made into an agent.`),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SettingsSection title={entry.name}>
        {made.map((agent) => (
          <SettingsRow
            key={agent.id}
            label={agent.name}
            description="An agent made from this template"
          />
        ))}
        <SettingsRow label="Make another agent from it">
          <Button size="sm" disabled={busy} onClick={() => void again()}>
            Make agent
          </Button>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

function McpManage({ entry }: { entry: McpEntry }) {
  const mcp = useMcpHere();
  const nav = useExploreNav();
  const engines = useReadyEngines().filter((engine) => engine.mcp);
  const { confirm, dialog } = useConfirmDelete();
  const here = mcp.of(entry);
  const removable = [
    ...new Set(
      here.configured
        .filter((one) => engines.some((engine) => engine.id === one.engine))
        .map((one) => one.engine),
    ),
  ];
  if (here.connection)
    return (
      <>
        <SettingsSection title={entry.name}>
          <SettingsRow
            label={`Signed in to ${entry.maker}`}
            description="As you, on this computer only"
          >
            <Button
              size="sm"
              onClick={() =>
                void disconnectRemote(here.connection?.id ?? "").then(
                  mcp.reload,
                  (reason: unknown) =>
                    notify({
                      message: failureText(reason, `${entry.name} couldn't be signed out.`),
                      tone: "error",
                    }),
                )
              }
            >
              Sign out
            </Button>
          </SettingsRow>
        </SettingsSection>
      </>
    );
  if (here.configured.length)
    return (
      <>
        <SettingsSection title={entry.name}>
          {here.configured.map((one) => {
            const engine = engines.find((each) => each.id === one.engine);
            return (
              <SettingsRow
                key={one.id}
                label={engine?.name ?? one.engine}
                leading={
                  <Mark of={`engine:${one.engine}`} label={engine?.name ?? one.engine} size={18} />
                }
              >
                <Switch
                  checked={one.enabled}
                  disabled={!one.writable}
                  aria-label={`${entry.name} in ${engine?.name ?? one.engine}`}
                  onCheckedChange={(next) =>
                    void mcp.setEnabled(one, next).catch((reason: unknown) =>
                      notify({
                        message: failureText(reason, `${entry.name} couldn't be changed.`),
                        tone: "error",
                      }),
                    )
                  }
                />
              </SettingsRow>
            );
          })}
          {removable.length ? (
            <SettingsRow label="Remove from every engine">
              <Button
                variant="danger"
                size="sm"
                onClick={() =>
                  void confirm({
                    title: `Remove ${entry.name}?`,
                    what: `${entry.name} leaves every engine on this computer, with any keys it was given. You can get it again here.`,
                    confirmLabel: "Remove",
                    onConfirm: async () => {
                      await removePackage(entry, removable);
                      mcp.reload();
                      nav.closeManage();
                    },
                  })
                }
              >
                Remove
              </Button>
            </SettingsRow>
          ) : null}
        </SettingsSection>
        {dialog}
      </>
    );
  if (entry.remote || !runsHere(entry) || !entry.env?.length) return null;
  return (
    <McpSetUp entry={entry} engines={engines.map((engine) => engine.id)} onAdded={mcp.reload} />
  );
}

function McpSetUp({
  entry,
  engines,
  onAdded,
}: {
  entry: McpEntry;
  engines: string[];
  onAdded: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const env = entry.env ?? [];
  const ready = env.every((one) => !one.required || values[one.name]?.trim());
  const add = async () => {
    setBusy(true);
    try {
      await addPackage(
        entry,
        engines,
        env.flatMap((one) =>
          values[one.name]?.trim() ? [[one.name, values[one.name].trim()] as [string, string]] : [],
        ),
      );
      onAdded();
    } catch (reason) {
      notify({ message: failureText(reason, `${entry.name} couldn't be added.`), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <RowGroupLabel title={`Set up ${entry.name}`} />
      <div className="grid gap-4">
        {env.map((one) => (
          <Field key={one.name} label={one.required ? one.name : `${one.name} (optional)`}>
            <Input
              type={one.secret ? "password" : "text"}
              autoComplete="off"
              value={values[one.name] ?? ""}
              onChange={(event) =>
                setValues((current) => ({ ...current, [one.name]: event.target.value }))
              }
            />
          </Field>
        ))}
        <div>
          <Button
            variant="get"
            disabled={busy || !ready || !engines.length}
            onClick={() => void add()}
          >
            {engines.length === 1 ? "Add to your engine" : "Add to your engines"}
          </Button>
        </div>
      </div>
    </>
  );
}
