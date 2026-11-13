import type { UpdateShortcutRequest } from "@/native/ipc";
import {
  Button,
  cn,
  MistyMark,
  SearchField,
  Skeleton,
  SkeletonControl,
  spaceIcons,
  Text,
  type MenuIcon,
} from "@/shared/ui";

import { AppWindow, AppWindowMac, ArrowLeftRight, Keyboard, LayoutPanelLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  DesktopSettingsNotice,
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "@/features/settings";
import { booleanSetting, DropdownControl, SwitchControl } from "../../settings/SettingsControls";
import type { SettingsContentProps } from "../../settings/settingsTypes";
import { ShortcutCommandRow, type ShortcutConflict } from "./ShortcutCommandRow";
import { findShortcutConflict, groupShortcutsByCategory } from "./shortcutSettingsModel";
import { settingsDisabledControlClass } from "../../settings/settingsConstants";

/** A recorded shortcut that another command already uses, waiting for Reassign. */
interface PendingConflict {
  commandId: string;
  value: string;
  conflictingCommandId: string;
  conflictingSlot: "primary" | "alternate";
  message: string;
}

/** While a shortcut is recorded, the app's own shortcuts stand aside (runtime.tsx reads this). */
function holdAppShortcuts(recording: boolean) {
  if (recording) document.documentElement.dataset.shortcutCapture = "true";
  else delete document.documentElement.dataset.shortcutCapture;
}

const skeletonWidths = ["w-32", "w-40", "w-28", "w-36"];

/**
 * Command rows on a first load, in ShortcutCommandRow's shape: a name over its description line,
 * then the 192px shortcut field and the restore button. The first row names what is loading for
 * screen readers, as the panel insets only its direct rows.
 */
function ShortcutRowsSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          // An empty label keeps the panel's padding and hairlines without naming a command.
          data-setting-label=""
          role={index === 0 ? "status" : undefined}
          aria-label={index === 0 ? "Shortcuts" : undefined}
          aria-busy={index === 0 || undefined}
          className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-8 py-3"
        >
          <div className="grid min-w-0 gap-1">
            <div className="flex h-6 items-center">
              <Skeleton className={cn("h-4", skeletonWidths[index % skeletonWidths.length])} />
            </div>
            <div className="flex h-6 items-center">
              <Skeleton className="h-3.5 w-2/3" />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <SkeletonControl kind="field" className="w-48" />
            <SkeletonControl kind="icon" />
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * Each shortcut category wears the icon its subject wears elsewhere in Misty: the layout button
 * for View, "New tab" for Tabs, the back and forward pair for Navigation, the Space's own icons.
 * A category named later by a feature falls back to the keyboard.
 */
const categoryIcons: Record<string, MenuIcon> = {
  Misty: <MistyMark size={16} />,
  View: LayoutPanelLeft,
  Tabs: AppWindow,
  Windows: AppWindowMac,
  Navigation: ArrowLeftRight,
  Spaces: spaceIcons.space,
  Library: spaceIcons.library,
  Chat: spaceIcons.chat,
};

export function ShortcutsSection(props: SettingsContentProps) {
  const snapshot = props.shortcuts;
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const [lastUndo, setLastUndo] = useState<UpdateShortcutRequest[] | null>(null);

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

  /** Each command has one shortcut, recorded in its field; the field already left recording. */
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
    setLastUndo([{ commandId, slot: "primary", value: previous }]);
    void props.onShortcutChange({ commandId, slot: "primary", value });
  };

  const reassign = (pending: PendingConflict) => {
    const conflicting = bindingsById.get(pending.conflictingCommandId);
    setLastUndo([
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

  const categories = useMemo(
    () => groupShortcutsByCategory(definitions).map(([name]) => name),
    [definitions],
  );
  const shownCategory = categories.includes(category) ? category : (categories[0] ?? "");
  // Searching spans every category; otherwise one category shows at a time.
  const shown = query.trim()
    ? filtered
    : filtered.filter((definition) => definition.category === shownCategory);

  return (
    <>
      <SettingsSectionBlock title={query.trim() ? "Matches" : "Commands"}>
        <SettingsRow label="Show shortcut hints" description="In menus, tooltips and buttons.">
          <SwitchControl
            checked={booleanSetting(props.document, "shortcuts", "shortcut_hints_enabled", true)}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("shortcuts", "shortcut_hints_enabled", value)
            }
          />
        </SettingsRow>
        <div className="flex min-w-0 items-center gap-2 pb-3">
          <SearchField
            containerClassName="min-w-50 flex-1"
            aria-label="Search shortcuts"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search commands, tools, or shortcuts"
          />
          <DropdownControl
            label="Shortcut category"
            value={shownCategory}
            disabled={!snapshot || Boolean(query.trim())}
            options={categories.map((name) => ({
              value: name,
              label: name,
              icon: categoryIcons[name] ?? Keyboard,
            }))}
            onValueChange={setCategory}
          />
          <Button
            type="button"
            variant="secondary"
            className={settingsDisabledControlClass}
            disabled={props.working || !snapshot?.overrides?.length}
            onClick={() => {
              if (window.confirm("Restore every shortcut to its default?"))
                void props.onResetShortcuts();
            }}
          >
            Restore all
          </Button>
        </div>
        {lastUndo ? (
          <DesktopSettingsNotice
            action={
              <Button
                type="button"
                variant="quiet"
                onClick={() => {
                  const requests = lastUndo;
                  setLastUndo(null);
                  void requests.reduce(
                    (pending, request) => pending.then(() => props.onShortcutChange(request)),
                    Promise.resolve(),
                  );
                }}
              >
                Undo
              </Button>
            }
          >
            Shortcut changed.
          </DesktopSettingsNotice>
        ) : null}
        {!snapshot ? (
          <ShortcutRowsSkeleton />
        ) : shown.length === 0 ? (
          <Text bare as="p" tone="muted" className="py-2 text-sm">
            No matching commands.
          </Text>
        ) : (
          shown.map((definition) => {
            const binding = bindingsById.get(definition.id);
            if (!binding) return null;
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
          })
        )}
      </SettingsSectionBlock>
    </>
  );
}
