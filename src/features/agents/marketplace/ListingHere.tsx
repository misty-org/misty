import { useState } from "react";

import { skillsHubApi, type SkillTargetId } from "@/features/engine-config/skills";

import { registryInstalls } from "@/native/registry";

import {
  Button,
  CatalogNames,
  Field,
  Input,
  Mark,
  notify,
  SettingsRow,
  SettingsSection,
  StoreSheetSection,
  Switch,
  useConfirmDelete,
} from "@misty/ui";
import type { ListingEntry, McpEntry, PluginEntry } from "@/native/registry";
import {
  addPackage,
  disconnectRemote,
  removePackage,
  runsHere,
  useMcpHere,
  useReadyEngines,
  useInstallRecords,
  useSkillsHere,
  useTemplateAgents,
} from "./explore_installs";

import { failureText } from "./explore_index";
import type { ListingItem } from "./explore_view";

export function ListingHere({ item }: { item: ListingItem }) {
  if (item.kind === "skills") return <SkillHere entry={item.entry} />;
  if (item.kind === "templates") return <TemplateHere entry={item.entry} />;
  if (item.kind === "plugins") return <PluginHere entry={item.entry} />;
  return <McpHere entry={item.entry} />;
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <div>
      <Button variant="danger" onClick={onClick}>
        Remove
      </Button>
    </div>
  );
}

function SkillHere({ entry }: { entry: ListingEntry }) {
  const skills = useSkillsHere();
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
      {engines.length ? (
        <SettingsSection title="On your engines">
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
        </SettingsSection>
      ) : null}
      <RemoveButton
        onClick={() =>
          void confirm({
            title: `Remove ${entry.name}?`,
            what: `${entry.name} leaves every engine on this computer. You can get it again here.`,
            confirmLabel: "Remove",
            onConfirm: async () => {
              await skillsHubApi.uninstall(row.id);
              await skills.reload();
            },
          })
        }
      />
      {dialog}
    </>
  );
}

function PluginHere({ entry }: { entry: PluginEntry }) {
  const records = useInstallRecords();
  const engines = useReadyEngines();
  const { confirm, dialog } = useConfirmDelete();
  const record = records.data?.find((one) => one.kind === "plugins" && one.id === entry.id);
  if (!record) return null;
  const nameOf = (id: string) =>
    engines.find((engine) => engine.id === id || engine.skills === id)?.name ?? id;
  return (
    <>
      {record.placed.length ? (
        <SettingsSection title="On your engines">
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
        </SettingsSection>
      ) : null}
      <RemoveButton
        onClick={() =>
          void confirm({
            title: `Remove ${entry.name}?`,
            what: `${entry.name} leaves every engine on this computer. You can get it again here.`,
            confirmLabel: "Remove",
            onConfirm: async () => {
              await registryInstalls.removePlugin(entry.id);
              await records.reload();
            },
          })
        }
      />
      {dialog}
    </>
  );
}

function TemplateHere({ entry }: { entry: ListingEntry }) {
  const made = useTemplateAgents()(entry);
  if (!made.length) return null;
  return (
    <StoreSheetSection title="Agents made from it">
      <CatalogNames names={made.map((agent) => agent.name)} />
    </StoreSheetSection>
  );
}

function McpHere({ entry }: { entry: McpEntry }) {
  const mcp = useMcpHere();
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
      <SettingsSection title="Account">
        <SettingsRow
          label={`Signed in to ${entry.maker}`}
          description="As you, on this computer only"
        >
          <Button
            variant="quiet"
            size="sm"
            onClick={() =>
              void disconnectRemote(here.connection?.id ?? "").then(mcp.reload, (reason: unknown) =>
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
    );
  if (here.configured.length)
    return (
      <>
        <SettingsSection title="On your engines">
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
        </SettingsSection>
        {removable.length ? (
          <RemoveButton
            onClick={() =>
              void confirm({
                title: `Remove ${entry.name}?`,
                what: `${entry.name} leaves every engine on this computer, with any keys it was given. You can get it again here.`,
                confirmLabel: "Remove",
                onConfirm: async () => {
                  await removePackage(entry, removable);
                  mcp.reload();
                },
              })
            }
          />
        ) : null}
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
    <StoreSheetSection title={`Set up ${entry.name}`}>
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
    </StoreSheetSection>
  );
}
