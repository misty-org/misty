// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { Download, FileUp, Plus } from "lucide-react";
import { useState, type DragEvent } from "react";
import {
  DesktopSettingsNotice,
  DesktopSettingsRow,
  DesktopSettingsRowSkeleton,
  DesktopSettingsSection,
} from "@/features/settings";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Mark,
  MenuItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  type SectionHeadingAction,
} from "@misty/ui";
import { EngineSetupSections } from "../engine-setup/EngineSetupSections";
import { channelsApi } from "./api";
import { ChannelRow } from "./ChannelRow";
import {
  CC_SWITCH_ENGINES,
  ENGINE_IDS,
  ENGINE_NAMES,
  OFFICIAL_EDITABLE_ENGINES,
  type EngineId,
} from "./engines";
import { OfficialEditDialog } from "./OfficialEditDialog";
import { ProviderDialog, type ProviderFormValue } from "./ProviderDialog";
import {
  PSEUDO_LOCAL,
  claudeSettingsJson,
  codexAuthJson,
  codexConfigToml,
  type ProviderEntry,
} from "./providers";
import { useCliConfig, type CliConfigState } from "./use_cli_config";

function formValueOf(entry: ProviderEntry): ProviderFormValue {
  return {
    name: entry.name,
    remark: entry.remark,
    baseUrl: entry.baseUrl,
    apiKey: "",
    model: entry.model,
    settingsJson: claudeSettingsJson(entry.raw),
    configToml: codexConfigToml(entry.raw),
    authJson: codexAuthJson(entry.raw),
  };
}

export function EnginePicker({
  engine,
  onChange,
}: {
  engine: EngineId;
  onChange: (engine: EngineId) => void;
}) {
  return (
    <Select value={engine} onValueChange={(value) => onChange(value as EngineId)}>
      <SelectTrigger className="w-56" aria-label="Engine">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ENGINE_IDS.map((id) => (
          <SelectItem
            key={id}
            value={id}
            icon={<Mark of={`engine:${id}`} label={ENGINE_NAMES[id]} size={14} aria-hidden />}
            label={ENGINE_NAMES[id]}
          />
        ))}
      </SelectContent>
    </Select>
  );
}

function useDragOrder(cli: CliConfigState) {
  const [dragging, setDragging] = useState<string | null>(null);
  return (id: string) => ({
    dragging: dragging === id,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.effectAllowed = "move";
      setDragging(id);
    },
    onDragOver: (event: DragEvent) => {
      if (dragging && dragging !== id) event.preventDefault();
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      const from = dragging;
      setDragging(null);
      if (!from || from === id) return;
      const ids = cli.entries.map((entry) => entry.id).filter((existing) => existing !== from);
      ids.splice(ids.indexOf(id), 0, from);
      void cli.mutate(() => channelsApi.reorder(cli.engine, ids));
    },
  });
}

function channelsAction(cli: CliConfigState): SectionHeadingAction | undefined {
  if (!cli.sections || !cli.enabled) return undefined;
  const base = { label: "Add channel", icon: Plus, showLabel: true, disabled: cli.busy };
  if (!CC_SWITCH_ENGINES.includes(cli.engine))
    return { ...base, onSelect: () => cli.setDialog({}) };
  return {
    ...base,
    menu: (
      <>
        <MenuItem icon={Plus} label="New channel" onSelect={() => cli.setDialog({})} />
        <MenuItem
          icon={Download}
          label="Import or update from CC Switch"
          onSelect={() => void cli.syncCcSwitch(cli.engine)}
        />
        <MenuItem
          icon={FileUp}
          label="Choose a CC Switch file"
          onSelect={() => void cli.importCcSwitchFile()}
        />
      </>
    ),
  };
}

function ChannelsRows({ cli }: { cli: CliConfigState }) {
  const { engine, busy, enabled, entries, currentId } = cli;
  const dragFor = useDragOrder(cli);
  const name = ENGINE_NAMES[engine];
  return (
    <>
      <DesktopSettingsRow
        label={`Use ${name}`}
        description="While it's off, this engine is hidden from pickers and can't start new chats."
      >
        <Switch
          aria-label={`Use ${name}`}
          checked={enabled}
          disabled={busy}
          onCheckedChange={(on) => void cli.mutate(() => channelsApi.setEnabled(engine, on))}
        />
      </DesktopSettingsRow>
      {enabled ? (
        <>
          <DesktopSettingsRow
            label={`${name}'s own config`}
            description="Its own sign-in and config files"
            leading={<Mark of={`engine:${engine}`} size={16} label={name} aria-hidden />}
          >
            {OFFICIAL_EDITABLE_ENGINES.includes(engine) ? (
              <Button type="button" disabled={busy} onClick={() => cli.setOfficialEditing(true)}>
                Edit
              </Button>
            ) : null}
            <Switch
              aria-label={`${name}'s own config`}
              checked={cli.officialActive}
              disabled={busy || cli.officialActive}
              onCheckedChange={(on) => {
                if (on) cli.activate(PSEUDO_LOCAL);
              }}
            />
          </DesktopSettingsRow>
          {entries.map((entry) => (
            <ChannelRow
              key={entry.id}
              entry={entry}
              current={currentId === entry.id}
              busy={busy}
              drag={dragFor(entry.id)}
              onToggle={(on) => cli.activate(on ? entry.id : PSEUDO_LOCAL)}
              onEdit={() => cli.setDialog({ entry })}
              onDelete={() => cli.setPendingDelete(entry)}
            />
          ))}
        </>
      ) : null}
    </>
  );
}

export function ChannelsSection() {
  const [engine, setEngine] = useState<EngineId>("claude");
  const cli = useCliConfig(engine);
  const editing = cli.dialog?.entry;
  return (
    <>
      {cli.ccStatus?.changed ? (
        <DesktopSettingsNotice
          action={
            <Button
              variant="primary"
              disabled={cli.busy}
              onClick={() => void cli.syncCcSwitch("all")}
            >
              Import
            </Button>
          }
        >
          {cli.ccStatus.providers === 1
            ? "CC Switch changed: 1 channel to import"
            : `CC Switch changed: ${cli.ccStatus.providers} channels to import`}
        </DesktopSettingsNotice>
      ) : null}
      {cli.error ? <DesktopSettingsNotice>{cli.error}</DesktopSettingsNotice> : null}
      {cli.notice ? <DesktopSettingsNotice>{cli.notice}</DesktopSettingsNotice> : null}
      <DesktopSettingsSection
        title="Channels"
        section="engines-channels"
        action={channelsAction(cli)}
      >
        <DesktopSettingsRow label="Engine">
          <EnginePicker engine={engine} onChange={setEngine} />
        </DesktopSettingsRow>
        {cli.sections ? (
          <ChannelsRows cli={cli} />
        ) : cli.error ? null : (
          <DesktopSettingsRowSkeleton
            label="Reading channels"
            rows={2}
            description
            control="switch"
          />
        )}
      </DesktopSettingsSection>
      {cli.sections && cli.enabled ? <EngineSetupSections engine={engine} /> : null}

      {cli.dialog ? (
        <ProviderDialog
          key={editing?.id ?? "new"}
          engine={engine}
          title={editing ? "Edit channel" : `Add a ${ENGINE_NAMES[engine]} channel`}
          initial={editing ? formValueOf(editing) : undefined}
          channelId={editing?.id}
          hasKey={editing?.hasKey ?? false}
          onSubmit={cli.saveProvider}
          onCancel={() => cli.setDialog(null)}
        />
      ) : null}
      <OfficialEditDialog cli={cli} />
      <AlertDialog
        open={cli.pendingDelete != null}
        onOpenChange={(open) => (open ? undefined : cli.setPendingDelete(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{cli.pendingDelete?.name}”?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={cli.confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
