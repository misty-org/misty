// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * Settings › Engines › Channels: a third-party API an engine CLI starts against instead of its
 * own sign-in, per engine.
 *
 *   CC Switch banner (when its store changed)
 *   → the engine's switch (off hides it from pickers and refuses new chats)
 *   → its own config (the CLI's files, with an editor), then its channels, with drag to reorder
 *   → its program (path, Codex's home, custom models) and how it signs in (engine-setup/).
 *
 * A channel's key goes to this computer's keychain and only ever to the channel's provider; the
 * page only learns whether one is saved. Choosing a channel never writes the CLI's own files: it
 * applies to each new chat's start.
 */
import { Download, FileUp, Plus } from "lucide-react";
import { useState, type DragEvent } from "react";
import { EngineMark } from "../EngineMark";
import {
  DesktopSettingsNotice,
  DesktopSettingsRow,
  DesktopSettingsRowSkeleton,
  DesktopSettingsSection as Section,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  SkeletonControl,
  Switch,
  Surface,
  Text,
} from "@/shared/ui";
import { EngineSetupSections } from "../engine-setup/EngineSetupSections";
import { channelsApi } from "./api";
import { ChannelRow, Pill, ROW } from "./ChannelRow";
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
import { useCliConfig, type CliConfigState } from "./useCliConfig";

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

/** The engine whose channels the page shows. */
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
            icon={<EngineMark engine={id} name={ENGINE_NAMES[id]} size={14} />}
            label={ENGINE_NAMES[id]}
          />
        ))}
      </SelectContent>
    </Select>
  );
}

function CcSwitchImportMenu({ cli }: { cli: CliConfigState }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button icon={Download} disabled={cli.busy}>
          Import from CC Switch
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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
      </DropdownMenuContent>
    </DropdownMenu>
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

function ChannelsBody({ cli }: { cli: CliConfigState }) {
  const { engine, busy, enabled, entries, currentId } = cli;
  const dragFor = useDragOrder(cli);
  const name = ENGINE_NAMES[engine];
  return (
    <>
      <Section title={`${name} engine`}>
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
      </Section>

      {enabled ? (
        <>
          <Section title="Own config">
            <div
              role="button"
              tabIndex={0}
              className={`${ROW} cursor-pointer`}
              onClick={() => {
                if (!busy && !cli.officialActive) cli.activate(PSEUDO_LOCAL);
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if ((event.key === "Enter" || event.key === " ") && !cli.officialActive) {
                  event.preventDefault();
                  cli.activate(PSEUDO_LOCAL);
                }
              }}
            >
              <span className="flex size-8 shrink-0 items-center justify-center">
                <EngineMark engine={engine} size={16} name={name} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <Text bare as="p" tone="bright" className="flex items-center gap-1.5 text-sm">
                  <Text full>{name}'s own config</Text>
                  <Pill>Built in</Pill>
                </Text>
                <Text as="p" tone="muted" full className="text-xs">
                  Its own sign-in and config files
                </Text>
              </div>
              {OFFICIAL_EDITABLE_ENGINES.includes(engine) ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    cli.setOfficialEditing(true);
                  }}
                >
                  Edit
                </Button>
              ) : null}
              <span onClick={(event) => event.stopPropagation()}>
                <Switch
                  aria-label={`${name}'s own config`}
                  checked={cli.officialActive}
                  disabled={busy || cli.officialActive}
                  onCheckedChange={(on) => {
                    if (on) cli.activate(PSEUDO_LOCAL);
                  }}
                />
              </span>
            </div>
          </Section>

          <section aria-label="Channels" className="mb-8">
            <div className="mb-3 flex items-center justify-between gap-3">
              <Text bare as="h2" size="body" weight="semibold" tone="bright">
                Channels
              </Text>
              <div className="flex shrink-0 items-center gap-2">
                {CC_SWITCH_ENGINES.includes(engine) ? <CcSwitchImportMenu cli={cli} /> : null}
                <Button variant="primary" disabled={busy} onClick={() => cli.setDialog({})}>
                  <Plus />
                  Add channel
                </Button>
              </div>
            </div>
            <Surface tone="card" edge="hairline" radius="xl" className="overflow-hidden">
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
              {entries.length === 0 ? (
                <Text bare as="div" tone="muted" className="px-4 py-6 text-center text-sm">
                  No channels yet
                </Text>
              ) : null}
            </Surface>
          </section>

          <EngineSetupSections engine={engine} />
        </>
      ) : null}
    </>
  );
}

/**
 * The channels' first read, shaped like the page it turns into: the engine's switch row, then its
 * own config's card row with Edit (for engines whose files can be edited here) and its switch.
 */
function ChannelsSkeleton({ engine }: { engine: EngineId }) {
  const name = ENGINE_NAMES[engine];
  return (
    <>
      <Section title={`${name} engine`}>
        <DesktopSettingsRowSkeleton label="Reading channels" description control="switch" />
      </Section>
      <Section title="Own config">
        <div aria-hidden="true" className={ROW}>
          <span className="flex size-8 shrink-0 items-center justify-center">
            <Skeleton className="size-4 rounded-sm" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-5 items-center gap-1.5">
              <Skeleton className="h-3.5 w-36" />
              <SkeletonControl kind="badge" />
            </div>
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          {OFFICIAL_EDITABLE_ENGINES.includes(engine) ? (
            <SkeletonControl kind="button-sm" className="w-10" />
          ) : null}
          <SkeletonControl kind="switch" />
        </div>
      </Section>
    </>
  );
}

/** Settings › Engines › Channels. */
export function ChannelsSection() {
  const [engine, setEngine] = useState<EngineId>("claude");
  const cli = useCliConfig(engine);
  const editing = cli.dialog?.entry;
  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-3">
        <EnginePicker engine={engine} onChange={setEngine} />
      </div>
      {cli.ccStatus?.changed ? (
        <DesktopSettingsNotice
          action={
            <div className="flex gap-2">
              <Button onClick={cli.dismissCcSwitch}>Later</Button>
              <Button
                variant="primary"
                disabled={cli.busy}
                onClick={() => void cli.syncCcSwitch("all")}
              >
                Import
              </Button>
            </div>
          }
        >
          {cli.ccStatus.providers === 1
            ? "CC Switch changed: 1 channel to import"
            : `CC Switch changed: ${cli.ccStatus.providers} channels to import`}
        </DesktopSettingsNotice>
      ) : null}
      {cli.error ? <DesktopSettingsNotice>{cli.error}</DesktopSettingsNotice> : null}
      {cli.notice ? <DesktopSettingsNotice>{cli.notice}</DesktopSettingsNotice> : null}
      {cli.sections ? (
        <ChannelsBody cli={cli} />
      ) : cli.error ? null : (
        <ChannelsSkeleton engine={engine} />
      )}

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
