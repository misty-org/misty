import {
  formatShortcut,
  isReservedShortcut,
  shortcutFromEvent,
  type ShortcutSlot,
} from "@/features/shortcuts";
import type { ReassignShortcutRequest, UpdateShortcutRequest } from "@/native/contracts";
import { Button, Input, cn } from "@/shared/ui";
import { RotateCcw, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { booleanSetting, SwitchControl } from "../settingsControls";
import type { SettingsContentProps } from "../settingsTypes";
import {
  findShortcutConflict,
  groupShortcutsByCategory,
  shortcutCategorySlug,
  shortcutScopeLabel,
} from "./shortcutSettingsModel";
import { settingsDisabledControlClass } from "../settingsConstants";

interface CaptureTarget {
  commandId: string;
  slot: ShortcutSlot;
}

interface PendingConflict extends ReassignShortcutRequest {
  message: string;
}

export function ShortcutsSection(props: SettingsContentProps) {
  const snapshot = props.shortcuts;
  const [query, setQuery] = useState("");
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
  const groups = useMemo(() => groupShortcutsByCategory(filtered), [filtered]);

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

  return (
    <>
      <SettingsSectionBlock title="Shortcut behavior">
        <SettingsRow
          label="Show shortcut hints"
          description="Display current shortcuts in buttons, menus, tooltips, and command results."
          last
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

      <SettingsSectionBlock title="Commands">
        <div className="grid gap-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[220px] flex-1">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-cream-muted"
              />
              <Input
                aria-label="Search shortcuts"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search commands, tools, or shortcuts"
                className="pl-8"
              />
            </label>
            <span className="rounded-md border border-charcoal-border bg-charcoal-bg px-2 py-1 text-[11px] font-medium text-cream-muted">
              {snapshot?.profileName ?? "Desktop"} defaults
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={settingsDisabledControlClass}
              disabled={props.working || !snapshot?.overrides?.length}
              onClick={() => {
                if (window.confirm("Restore every shortcut to this device's defaults?"))
                  void props.onResetShortcuts();
              }}
            >
              Restore all defaults
            </Button>
          </div>

          <p className="m-0 max-w-2xl text-[13px] leading-[18px] text-cream-muted">
            Click a primary or alternate slot, then press a key combination. Escape cancels;
            Backspace or Delete clears the slot. Changes apply immediately.
          </p>
          {lastUndo ? (
            <div
              className={[
                "flex items-center justify-between gap-3 rounded-md border",
                "border-charcoal-border bg-charcoal-bg px-3 py-2 text-xs text-cream-muted",
              ].join(" ")}
            >
              <span>Shortcut change applied.</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="font-medium text-sage-fg hover:text-cream"
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
            </div>
          ) : null}

          {!snapshot ? (
            <div className="py-8 text-center text-sm text-cream-muted" role="status">
              Loading shortcuts…
            </div>
          ) : groups.length === 0 ? (
            <div className="py-8 text-center text-sm text-cream-muted">No matching commands.</div>
          ) : (
            <div className="grid gap-5">
              {groups.map(([category, categoryDefinitions]) => (
                <section
                  key={category}
                  aria-labelledby={`shortcut-category-${shortcutCategorySlug(category)}`}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <h3
                      id={`shortcut-category-${shortcutCategorySlug(category)}`}
                      className="text-xs font-semibold text-cream-muted"
                    >
                      {category}
                    </h3>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs text-cream-muted hover:text-cream"
                      onClick={() => {
                        if (window.confirm(`Restore every ${category} shortcut to defaults?`))
                          void props.onResetShortcuts({
                            commandIds: definitions
                              .filter((definition) => definition.category === category)
                              .map((definition) => definition.id),
                          });
                      }}
                    >
                      Restore category
                    </Button>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-charcoal-border/80">
                    {categoryDefinitions.map((definition) => {
                      const binding = bindingsById.get(definition.id);
                      if (!binding) return null;
                      const customized =
                        binding.primarySource === "user" || binding.alternateSource === "user";
                      return (
                        <div
                          key={definition.id}
                          className={cn(
                            "grid gap-2 border-b border-charcoal-border/70 bg-charcoal-card p-3",
                            "last:border-b-0 md:grid-cols-[minmax(180px,1fr)_minmax(280px,auto)] md:items-center",
                          )}
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-medium text-cream">
                                {definition.label}
                              </span>
                              <span className="rounded-sm bg-charcoal-bg px-1.5 py-0.5 text-[10px] text-cream-muted">
                                {shortcutScopeLabel(definition.scope)}
                              </span>
                              {customized ? (
                                <span className="rounded-sm bg-sage-bg px-1.5 py-0.5 text-[10px] text-sage-fg">
                                  Custom
                                </span>
                              ) : null}
                              {definition.allowShadowing ? (
                                <span
                                  className="rounded-sm bg-charcoal-bg px-1.5 py-0.5 text-[10px] text-cream-muted"
                                  title="A focused tool may intentionally use this shortcut before a broader Misty action."
                                >
                                  Contextual
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-0.5 text-xs leading-relaxed text-cream-muted">
                              {definition.description}
                            </p>
                          </div>
                          <div className="flex min-w-0 items-center justify-end gap-1.5">
                            <BindingSlot
                              label="Primary"
                              commandId={definition.id}
                              slot="primary"
                              value={binding.primary}
                              source={binding.primarySource}
                              platform={snapshot.detectedPlatform}
                              capturing={
                                capture?.commandId === definition.id && capture.slot === "primary"
                              }
                              disabled={props.working}
                              onBegin={beginCapture}
                              onKeyDown={record}
                              onClear={(target) => void updateBinding({ ...target, value: null })}
                            />
                            <BindingSlot
                              label="Alternate"
                              commandId={definition.id}
                              slot="alternate"
                              value={binding.alternate}
                              source={binding.alternateSource}
                              platform={snapshot.detectedPlatform}
                              capturing={
                                capture?.commandId === definition.id && capture.slot === "alternate"
                              }
                              disabled={props.working}
                              onBegin={beginCapture}
                              onKeyDown={record}
                              onClear={(target) => void updateBinding({ ...target, value: null })}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className={cn(
                                "grid size-8 shrink-0 place-items-center rounded-md text-cream-muted hover:bg-charcoal-hover hover:text-cream",
                                settingsDisabledControlClass,
                              )}
                              aria-label={`Restore ${definition.label}`}
                              title="Restore this command"
                              disabled={props.working || !customized}
                              onClick={() =>
                                void props.onResetShortcuts({ commandId: definition.id })
                              }
                            >
                              <RotateCcw size={13} />
                            </Button>
                          </div>
                          {capture?.commandId === definition.id &&
                          (captureError || pendingConflict) ? (
                            <div
                              className="text-xs text-notification-red md:col-start-2"
                              role="alert"
                            >
                              {pendingConflict ? (
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                  <span>{pendingConflict.message}</span>
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => {
                                      const { message: _message, ...request } = pendingConflict;
                                      const targetBinding = bindingsById.get(request.commandId);
                                      const conflictBinding = bindingsById.get(
                                        request.conflictingCommandId,
                                      );
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
                                    }}
                                  >
                                    Reassign
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={stopCapture}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <p className="text-right">{captureError}</p>
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </SettingsSectionBlock>
    </>
  );
}

function BindingSlot(props: {
  label: string;
  commandId: string;
  slot: ShortcutSlot;
  value: string | null;
  source: "default" | "user";
  platform: "macos" | "windows" | "linux";
  capturing: boolean;
  disabled: boolean;
  onBegin: (target: CaptureTarget) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, target: CaptureTarget) => void;
  onClear: (target: CaptureTarget) => void;
}) {
  const target = { commandId: props.commandId, slot: props.slot };
  return (
    <div className="group/slot relative min-w-[106px]">
      <Button
        type="button"
        variant="ghost"
        disabled={props.disabled}
        aria-label={`${props.label} shortcut${props.value ? `: ${props.value}` : ": unbound"}`}
        onClick={() => props.onBegin(target)}
        onKeyDown={(event) => (props.capturing ? props.onKeyDown(event, target) : undefined)}
        className={cn(
          "flex h-8 w-full items-center justify-center gap-0.5 rounded border px-2",
          "text-xs outline-none transition",
          props.capturing
            ? "border-charcoal-active bg-charcoal-hover text-cream ring-1 ring-charcoal-active/40"
            : "border-charcoal-border bg-charcoal-bg text-cream-muted hover:border-charcoal-active",
          settingsDisabledControlClass,
        )}
      >
        {props.capturing ? (
          <span>Press shortcut…</span>
        ) : props.value ? (
          formatShortcut(props.value, props.platform).map((keycap) => (
            <kbd key={keycap} className="font-sans text-[11px]">
              {keycap}
            </kbd>
          ))
        ) : (
          <span className="text-cream-muted">Unbound</span>
        )}
      </Button>
      {props.value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn(
            "absolute -right-1 -top-1 grid size-4 place-items-center rounded-full",
            "bg-charcoal-border text-cream-muted opacity-0 transition-opacity hover:text-cream",
            "group-hover/slot:opacity-100 group-focus-within/slot:opacity-100 max-[720px]:opacity-100",
          )}
          aria-label={`Clear ${props.label.toLowerCase()} shortcut`}
          onClick={(event) => {
            event.stopPropagation();
            props.onClear(target);
          }}
        >
          <Trash2 size={9} />
        </Button>
      ) : null}
      <span className="sr-only">{props.source === "user" ? "Custom" : "Default"}</span>
    </div>
  );
}
