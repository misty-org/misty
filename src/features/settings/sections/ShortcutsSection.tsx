import { isReservedShortcut, shortcutFromEvent } from "@/features/shortcuts";
import type { ReassignShortcutRequest, UpdateShortcutRequest } from "@/native/ipc";
import { Button, Input, SkeletonList } from "@/shared/ui";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  DesktopSettingsNotice,
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { booleanSetting, DropdownControl, SwitchControl } from "../SettingsControls";
import type { SettingsContentProps } from "../settingsTypes";
import { type CaptureTarget, ShortcutCommandRow } from "./ShortcutCommandRow";
import { findShortcutConflict, groupShortcutsByCategory } from "./shortcutSettingsModel";
import { settingsDisabledControlClass } from "../settingsConstants";

interface PendingConflict extends ReassignShortcutRequest {
  message: string;
}

export function ShortcutsSection(props: SettingsContentProps) {
  const snapshot = props.shortcuts;
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [capture, setCapture] = useState<CaptureTarget | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null);
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

  useEffect(
    () => () => {
      delete document.documentElement.dataset.shortcutCapture;
    },
    [],
  );

  const stopCapture = () => {
    delete document.documentElement.dataset.shortcutCapture;
    setCapture(null);
    setCaptureError(null);
    setPendingConflict(null);
  };

  const beginCapture = (target: CaptureTarget) => {
    document.documentElement.dataset.shortcutCapture = "true";
    setCapture(target);
    setCaptureError(null);
    setPendingConflict(null);
  };

  const updateBinding = async (request: UpdateShortcutRequest) => {
    const current = bindingsById.get(request.commandId);
    setLastUndo(
      current
        ? [{ commandId: request.commandId, slot: request.slot, value: current[request.slot] }]
        : null,
    );
    stopCapture();
    await props.onShortcutChange(request);
  };

  const record = (event: React.KeyboardEvent<HTMLButtonElement>, target: CaptureTarget) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      stopCapture();
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      void updateBinding({ ...target, value: null });
      return;
    }
    const value = shortcutFromEvent(event.nativeEvent);
    if (!value) {
      setCaptureError("Add a non-modifier key to finish the shortcut.");
      return;
    }
    const reserved = isReservedShortcut(value, snapshot?.detectedPlatform ?? "linux");
    if (reserved) {
      setCaptureError(reserved);
      return;
    }

    const conflict = findShortcutConflict(target, value, definitions, bindingsById);
    if (conflict) {
      setPendingConflict({
        ...target,
        value,
        conflictingCommandId: conflict.commandId,
        conflictingSlot: conflict.slot,
        message: `${value} is already used by ${conflict.label} in ${conflict.scope}.`,
      });
      setCaptureError(null);
      return;
    }
    void updateBinding({ ...target, value });
  };

  const categories = useMemo(
    () => groupShortcutsByCategory(definitions).map(([name]) => name),
    [definitions],
  );
  const shownCategory = categories.includes(category) ? category : (categories[0] ?? "");
  // Searching spans every category; otherwise one category shows at a time.
  const shown = query.trim()
    ? filtered
    : filtered.filter((definition) => definition.category === shownCategory);
  const problemFor = (commandId: string) => {
    if (capture?.commandId !== commandId) return null;
    if (pendingConflict)
      return {
        message: pendingConflict.message,
        onCancel: stopCapture,
        onReassign: () => {
          const { message: _message, ...request } = pendingConflict;
          const targetBinding = bindingsById.get(request.commandId);
          const conflictBinding = bindingsById.get(request.conflictingCommandId);
          setLastUndo([
            {
              commandId: request.commandId,
              slot: request.slot,
              value: targetBinding?.[request.slot] ?? null,
            },
            {
              commandId: request.conflictingCommandId,
              slot: request.conflictingSlot,
              value: conflictBinding?.[request.conflictingSlot] ?? null,
            },
          ]);
          stopCapture();
          void props.onShortcutReassign(request);
        },
      };
    return captureError ? { message: captureError } : null;
  };

  return (
    <>
      <SettingsSectionBlock title="Shortcut behavior">
        <SettingsRow
          label="Show shortcut hints"
          description="Display current shortcuts in buttons, menus, tooltips, and command results."
        >
          <SwitchControl
            checked={booleanSetting(props.document, "shortcuts", "shortcut_hints_enabled", true)}
            disabled={props.working}
            onChange={(value) =>
              props.onSettingChange("shortcuts", "shortcut_hints_enabled", value)
            }
          />
        </SettingsRow>
      </SettingsSectionBlock>

      <SettingsSectionBlock
        title={query.trim() ? "Matching commands" : shownCategory || "Commands"}
      >
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <label className="relative min-w-[200px] flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute inset-y-0 left-2.5 my-auto text-cream-muted"
            />
            <Input
              aria-label="Search shortcuts"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search commands, tools, or shortcuts"
              className="pl-8"
            />
          </label>
          <DropdownControl
            label="Shortcut category"
            value={shownCategory}
            disabled={!snapshot || Boolean(query.trim())}
            options={categories.map((name) => ({ value: name, label: name }))}
            onValueChange={setCategory}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
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
                variant="ghost"
                size="sm"
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
          <SkeletonList label="Shortcuts" rows={8} leading="none" lines={1} trailing />
        ) : shown.length === 0 ? (
          <p className="border-t border-charcoal-border py-3 text-sm text-cream-muted">
            No matching commands.
          </p>
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
                capture={capture}
                problem={problemFor(definition.id)}
                disabled={props.working}
                onBegin={beginCapture}
                onKeyDown={record}
                onClear={(target) => void updateBinding({ ...target, value: null })}
                onRestore={() => void props.onResetShortcuts({ commandId: definition.id })}
              />
            );
          })
        )}
      </SettingsSectionBlock>
    </>
  );
}
