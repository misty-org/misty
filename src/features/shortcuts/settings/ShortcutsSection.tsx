import type { UpdateShortcutRequest } from "@/native/ipc";
import { Button, EmptyState, notify, SearchField } from "@misty/ui";
import { useEffect, useMemo, useState } from "react";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsRowSkeleton,
  DesktopSettingsSection,
  SettingsPageBar,
} from "@/features/settings";
import { booleanSetting, SwitchControl } from "../../settings/SettingsControls";
import type { SettingsContentProps } from "../../settings/settings_types";
import { ShortcutCommandRow, type ShortcutConflict } from "./ShortcutCommandRow";
import { findShortcutConflict, groupShortcutsByCategory } from "./shortcut_settings_model";
import { settingsDisabledControlClass } from "../../settings/settings_constants";
import { confirmAction } from "@/shared/lib/confirm_action";

interface PendingConflict {
  commandId: string;
  value: string;
  conflictingCommandId: string;
  conflictingSlot: "primary" | "alternate";
  message: string;
}

function holdAppShortcuts(recording: boolean) {
  if (recording) document.documentElement.dataset.shortcutCapture = "true";
  else delete document.documentElement.dataset.shortcutCapture;
}

export function ShortcutHintsRow(props: SettingsContentProps) {
  return (
    <SettingsRow label="Show shortcut hints" description="In menus, tooltips and buttons.">
      <SwitchControl
        checked={booleanSetting(props.document, "shortcuts", "shortcut_hints_enabled", true)}
        disabled={props.working}
        onChange={(value) => props.onSettingChange("shortcuts", "shortcut_hints_enabled", value)}
      />
    </SettingsRow>
  );
}

export function ShortcutsSection(props: SettingsContentProps) {
  const snapshot = props.shortcuts;
  const [query, setQuery] = useState("");
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const offerUndo = (requests: UpdateShortcutRequest[]) =>
    notify({
      message: "Shortcut changed",
      action: {
        label: "Undo",
        onSelect: () =>
          void requests.reduce(
            (pending, request) => pending.then(() => props.onShortcutChange(request)),
            Promise.resolve(),
          ),
      },
    });

  const definitions = useMemo(
    () => snapshot?.commandDefinitions ?? [],
    [snapshot?.commandDefinitions],
  );
  const bindingsById = useMemo(
    () =>
      new Map(snapshot?.effectiveBindings?.map((binding) => [binding.commandId, binding]) ?? []),
    [snapshot?.effectiveBindings],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return definitions;
    return definitions.filter((definition) => {
      const binding = bindingsById.get(definition.id);
      return [
        definition.label,
        definition.description,
        definition.category,
        definition.scope,
        ...definition.aliases,
        binding?.primary ?? "",
        binding?.alternate ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [bindingsById, definitions, query]);

  useEffect(() => () => holdAppShortcuts(false), []);

  const record = (commandId: string, value: string | null) => {
    const previous = bindingsById.get(commandId)?.primary ?? null;
    if (value) {
      const clash = findShortcutConflict(
        { commandId, slot: "primary" },
        value,
        definitions,
        bindingsById,
      );
      if (clash) {
        setConflict({
          commandId,
          value,
          conflictingCommandId: clash.commandId,
          conflictingSlot: clash.slot,
          message: `${value} is already used by ${clash.label} in ${clash.scope}.`,
        });
        return;
      }
    }
    setConflict(null);
    offerUndo([{ commandId, slot: "primary", value: previous }]);
    void props.onShortcutChange({ commandId, slot: "primary", value });
  };

  const reassign = (pending: PendingConflict) => {
    const conflicting = bindingsById.get(pending.conflictingCommandId);
    offerUndo([
      {
        commandId: pending.commandId,
        slot: "primary",
        value: bindingsById.get(pending.commandId)?.primary ?? null,
      },
      {
        commandId: pending.conflictingCommandId,
        slot: pending.conflictingSlot,
        value: conflicting?.[pending.conflictingSlot] ?? null,
      },
    ]);
    setConflict(null);
    void props.onShortcutReassign({
      commandId: pending.commandId,
      slot: "primary",
      value: pending.value,
      conflictingCommandId: pending.conflictingCommandId,
      conflictingSlot: pending.conflictingSlot,
    });
  };

  const conflictFor = (commandId: string): ShortcutConflict | null =>
    conflict?.commandId === commandId
      ? { message: conflict.message, onReassign: () => reassign(conflict) }
      : null;

  const groups = useMemo(() => groupShortcutsByCategory(filtered), [filtered]);
  const row = (definition: (typeof definitions)[number]) => {
    const binding = bindingsById.get(definition.id);
    if (!binding || !snapshot) return null;
    return (
      <ShortcutCommandRow
        key={definition.id}
        definition={definition}
        binding={binding}
        platform={snapshot.detectedPlatform}
        conflict={conflictFor(definition.id)}
        disabled={props.working}
        onRecordingChange={(recording) => {
          holdAppShortcuts(recording);
          if (recording) setConflict(null);
        }}
        onChange={(value) => record(definition.id, value)}
        onRestore={() => void props.onResetShortcuts({ commandId: definition.id })}
      />
    );
  };

  return (
    <>
      <SettingsPageBar>
        <SearchField
          containerClassName="w-60"
          aria-label="Search shortcuts"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
          placeholder="Search shortcuts"
        />
        <Button
          type="button"
          variant="secondary"
          className={settingsDisabledControlClass}
          disabled={props.working || !snapshot?.overrides?.length}
          onClick={() =>
            void confirmAction(
              "Every shortcut you changed goes back to its default.",
              "Restore all shortcuts?",
            ).then((yes) => {
              if (yes) void props.onResetShortcuts();
            })
          }
        >
          Restore all
        </Button>
      </SettingsPageBar>
      {!snapshot ? (
        <DesktopSettingsSection title="Commands" section="commands">
          <DesktopSettingsRowSkeleton label="Shortcuts" rows={8} control={["field", "icon"]} />
        </DesktopSettingsSection>
      ) : groups.length === 0 ? (
        <EmptyState inline title="No matching commands" line="Try another word or shortcut." />
      ) : (
        groups.map(([category, commands]) => (
          <DesktopSettingsSection key={category} title={category}>
            {commands.map(row)}
          </DesktopSettingsSection>
        ))
      )}
    </>
  );
}
