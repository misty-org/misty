import { useCliStatuses } from "@/features/engine-config/clis";
import { skillsHubApi, type SkillRow } from "@/features/engine-config/skills";
import {
  Button,
  EmptyState,
  StoreCards,
  StoreList,
  StoreRow,
  StoreSection,
  useConfirmDelete,
} from "@misty/ui";
import { registryInstalls } from "@/native/registry";
import { usePersonalAgentsStore } from "../personal/personal_agents_store";
import { useRegistryEngineIds, useRegistryEngines } from "./engine_catalog";
import { EngineCard } from "./ExploreEngines";
import { HearingCard } from "./ExploreSpeech";
import { useSpeech } from "./ExploreSpeechParts";
import { useInstallRecords, useSkillsHere } from "./explore_installs";
import { useExploreNav } from "./explore_view";
import { ListingItem, ListingLogo } from "./ListingRows";
import { MakerTile, pluginMaker } from "./PluginMaker";
import { useFoundEntries } from "./explore_updates";

const repoLink = (skill: SkillRow) =>
  skill.repoOwner && skill.repoName
    ? `https://github.com/${skill.repoOwner}/${skill.repoName}`
    : null;

export function SkillLogo({ skill }: { skill: SkillRow }) {
  return <MakerTile maker={pluginMaker({ link: repoLink(skill) })} name={skill.name} />;
}

export function NothingYet() {
  const agents = usePersonalAgentsStore((store) => store.agents);
  const skills = useSkillsHere();
  const records = useInstallRecords();
  const used = agents.some((agent) => agent.origin?.startsWith("template:"));
  if (used || skills.rows?.length || records.data?.some((one) => one.kind === "plugins"))
    return null;
  return (
    <EmptyState inline title="Nothing here yet" line="What you get in Explore shows up here." />
  );
}

export function UsedTemplates() {
  const agents = usePersonalAgentsStore((store) => store.agents);
  const ids = agents.flatMap((agent) =>
    agent.origin?.startsWith("template:") ? [agent.origin.slice("template:".length)] : [],
  );
  const templates = useFoundEntries("templates", ids);
  if (!templates.length) return null;
  return (
    <StoreSection title="Templates you've used">
      <StoreList label="Templates you've used">
        {templates.map((entry) => (
          <ListingItem key={entry.id} kind="templates" entry={entry} />
        ))}
      </StoreList>
    </StoreSection>
  );
}

export function HeldSkillsAndPlugins() {
  const nav = useExploreNav();
  const skills = useSkillsHere();
  const records = useInstallRecords();
  const { confirm, dialog } = useConfirmDelete();
  const rows = skills.rows ?? [];
  const held = (records.data ?? []).filter((one) => one.kind === "plugins");
  const skillEntries = useFoundEntries(
    "skills",
    rows.flatMap((row) => (row.registryId ? [row.registryId] : [])),
  );
  const pluginEntries = useFoundEntries(
    "plugins",
    held.map((one) => one.id),
  );
  if (!rows.length && !held.length) return null;
  const removeSkill = (row: SkillRow) =>
    void confirm({
      title: `Remove ${row.name}?`,
      what: `${row.name} leaves every engine on this computer. You can get it again here.`,
      confirmLabel: "Remove",
      onConfirm: async () => {
        await skillsHubApi.uninstall(row.id);
        await skills.reload();
      },
    });
  const removePlugin = (id: string, name: string) =>
    void confirm({
      title: `Remove ${name}?`,
      what: `${name} leaves every engine on this computer. You can get it again here.`,
      confirmLabel: "Remove",
      onConfirm: async () => {
        await registryInstalls.removePlugin(id);
        await records.reload();
      },
    });
  const remove = (onClick: () => void) => (
    <Button size="sm" widthOf={["Remove"]} onClick={onClick}>
      Remove
    </Button>
  );
  return (
    <StoreSection title="Skills and plugins" detail="On your engines">
      <StoreList label="Skills and plugins on your engines">
        {rows.map((row) => {
          const entry = skillEntries.find((one) => one.id === row.registryId);
          return (
            <StoreRow
              key={`skill:${row.id}`}
              logo={entry ? <ListingLogo entry={entry} /> : <SkillLogo skill={row} />}
              title={row.name}
              line={row.description || undefined}
              maker={entry?.maker ?? row.repoOwner ?? undefined}
              action={row.readonly ? undefined : remove(() => removeSkill(row))}
              onOpen={entry ? () => nav.open({ kind: "skills", entry }) : undefined}
            />
          );
        })}
        {held.map((record) => {
          const entry = pluginEntries.find((one) => one.id === record.id);
          return (
            <StoreRow
              key={`plugin:${record.id}`}
              logo={
                entry ? (
                  <ListingLogo entry={entry} />
                ) : (
                  <MakerTile maker={pluginMaker({ link: null })} name={record.name} />
                )
              }
              title={record.name}
              line={entry?.description || undefined}
              maker={entry?.maker}
              action={remove(() => removePlugin(record.id, record.name))}
              onOpen={entry ? () => nav.open({ kind: "plugins", entry }) : undefined}
            />
          );
        })}
      </StoreList>
      {dialog}
    </StoreSection>
  );
}

export function HeldEngines() {
  const engines = useRegistryEngines();
  const { statuses } = useCliStatuses(useRegistryEngineIds(), { probe: false });
  const here = engines.filter((engine) => statuses[engine.id]?.installed);
  if (!here.length) return null;
  return (
    <StoreSection title="Engines">
      <StoreCards label="Engines on this computer">
        {here.map((engine) => (
          <EngineCard key={engine.id} engine={engine} />
        ))}
      </StoreCards>
    </StoreSection>
  );
}

export function HeldSpeech() {
  const { catalog, settings } = useSpeech();
  const held = (catalog?.hearing ?? []).filter((model) => model.installed);
  if (!held.length) return null;
  return (
    <StoreSection title="Speech">
      <StoreCards label="Speech on this computer">
        {held.map((model) => (
          <HearingCard key={model.id} model={model} current={settings.hearingModel} />
        ))}
      </StoreCards>
    </StoreSection>
  );
}
