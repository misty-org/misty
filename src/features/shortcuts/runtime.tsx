import { settingsBoolean, useSettingsStore } from "@/features/settings";
import { createPort } from "@/shared/lib/seams";
import { useEffect, useRef } from "react";
import {
  bindingPairMatchesEvent,
  detectShortcutPlatform,
  formatShortcutLabel,
  isEditableShortcutTarget,
} from "../../shared/shortcuts/bindings";
import {
  defaultBindingsFor,
  shortcutCommandsById,
  shortcutCommandRegistry,
  type ShortcutCommandDefinition,
  type ShortcutScope,
} from "../../shared/shortcuts/registry";

interface ShortcutInvocation {
  command: ShortcutCommandDefinition;
  event: KeyboardEvent;
  scope: ShortcutScope;
}

type ShortcutHandler = (invocation: ShortcutInvocation) => boolean | void;

interface HandlerRegistration {
  token: symbol;
  handler: ShortcutHandler;
  enabled: () => boolean;
  priority: number;
  order: number;
}

const handlers = new Map<string, HandlerRegistration[]>();
let nextHandlerOrder = 0;
/** Which scope the focused pane is in; the app knows the layout and fills this in at startup. */
export const shortcutScope = createPort<() => ShortcutScope>("the focused shortcut scope");
const defaultScope = (): ShortcutScope => "workspace";

export function registerShortcutHandler(
  commandId: string,
  handler: ShortcutHandler,
  enabled: () => boolean = () => true,
  priority = 0,
): () => void {
  const registration = {
    token: Symbol(commandId),
    handler,
    enabled,
    priority,
    order: nextHandlerOrder++,
  };
  handlers.set(commandId, [...(handlers.get(commandId) ?? []), registration]);
  return () => {
    const next = (handlers.get(commandId) ?? []).filter(
      (candidate) => candidate.token !== registration.token,
    );
    if (next.length) handlers.set(commandId, next);
    else handlers.delete(commandId);
  };
}

export function useShortcutHandler(
  commandId: string,
  handler: ShortcutHandler,
  enabled: boolean | (() => boolean) = true,
  priority = 0,
): void {
  const handlerRef = useRef(handler);
  const enabledRef = useRef(enabled);
  handlerRef.current = handler;
  enabledRef.current = enabled;
  useEffect(
    () =>
      registerShortcutHandler(
        commandId,
        (invocation) => handlerRef.current(invocation),
        () => {
          const current = enabledRef.current;
          return typeof current === "function" ? current() : current;
        },
        priority,
      ),
    [commandId, priority],
  );
}

export function dispatchShortcutEvent(event: KeyboardEvent, editableOverride?: boolean): boolean {
  if (event.defaultPrevented || document.documentElement.dataset.shortcutCapture === "true")
    return false;
  const editable = editableOverride ?? isEditableShortcutTarget(event.target);
  // Plain typing in a field: every command allowed in one needs Cmd, Ctrl or Option,
  // so skip the registry scan below rather than run it on each keystroke.
  if (editable && !event.metaKey && !event.ctrlKey && !event.altKey) return false;
  const activeScope = (shortcutScope.maybe() ?? defaultScope)();
  const snapshot = useSettingsStore.getState().shortcuts;
  const platform = snapshot?.detectedPlatform ?? detectShortcutPlatform();
  const effectiveById = new Map(
    snapshot?.effectiveBindings.map((binding) => [binding.commandId, binding]) ?? [],
  );

  const candidates = shortcutCommandRegistry
    .filter((definition) => scopeIsActive(definition.scope, activeScope))
    .filter((definition) => definition.repeatable || !event.repeat)
    .filter((definition) => definition.allowInEditable || !editable)
    .filter((definition) => {
      const storedOverride = snapshot?.overrides.find(
        (override) => override.commandId === definition.id,
      );
      const defaults = defaultBindingsFor(definition, platform);
      const effective = effectiveById.get(definition.id) ?? {
        primary: storedOverride?.primary !== undefined ? storedOverride.primary : defaults.primary,
        alternate:
          storedOverride?.alternate !== undefined ? storedOverride.alternate : defaults.alternate,
      };
      return bindingPairMatchesEvent(effective, event);
    })
    .sort(
      (left, right) => scopeRank(right.scope, activeScope) - scopeRank(left.scope, activeScope),
    );

  for (const definition of candidates) {
    const registrations = orderedRegistrations(definition.id);
    for (const registration of registrations) {
      if (!registration.enabled()) continue;
      const handled = registration.handler({ command: definition, event, scope: activeScope });
      if (handled === false) continue;
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
  }
  return false;
}

export function invokeShortcutCommand(commandId: string): boolean {
  const definition = shortcutCommandsById.get(commandId);
  if (!definition) return false;
  const activeScope = (shortcutScope.maybe() ?? defaultScope)();
  if (!scopeIsActive(definition.scope, activeScope)) return false;
  const target = document.activeElement;
  const editable = isEditableShortcutTarget(target);
  if (!definition.allowInEditable && editable) return false;
  const event = new KeyboardEvent("keydown", { cancelable: true });
  for (const registration of orderedRegistrations(commandId)) {
    if (!registration.enabled()) continue;
    const handled = registration.handler({ command: definition, event, scope: activeScope });
    if (handled === false) continue;
    return true;
  }
  return false;
}

/** Whether a mounted handler would run the command now, as the command palette asks before it
 * lists one. Focus isn't checked: the palette's own field has it. */
export function canInvokeShortcutCommand(commandId: string): boolean {
  const definition = shortcutCommandsById.get(commandId);
  if (!definition) return false;
  const activeScope = (shortcutScope.maybe() ?? defaultScope)();
  if (!scopeIsActive(definition.scope, activeScope)) return false;
  return orderedRegistrations(commandId).some((registration) => registration.enabled());
}

function orderedRegistrations(commandId: string): HandlerRegistration[] {
  return [...(handlers.get(commandId) ?? [])].sort(
    (left, right) => right.priority - left.priority || right.order - left.order,
  );
}

function effectiveShortcut(commandId: string): {
  primary: string | null;
  alternate: string | null;
} {
  const snapshot = useSettingsStore.getState().shortcuts;
  const effective = snapshot?.effectiveBindings.find((binding) => binding.commandId === commandId);
  if (effective) return effective;
  const definition = shortcutCommandsById.get(commandId);
  return definition
    ? defaultBindingsFor(definition, snapshot?.detectedPlatform ?? detectShortcutPlatform())
    : { primary: null, alternate: null };
}

function useEffectiveShortcut(commandId: string) {
  useSettingsStore((state) => state.shortcuts);
  return effectiveShortcut(commandId);
}

/** A command's shortcut as plain text (such as "⇧⌘T"), for menus. */
export function ShortcutText(props: { commandId: string; className?: string }) {
  const hintsEnabled = useSettingsStore((state) =>
    settingsBoolean(state.settings?.document ?? {}, "shortcuts", "shortcut_hints_enabled", true),
  );
  const binding = useEffectiveShortcut(props.commandId);
  const platform =
    useSettingsStore((state) => state.shortcuts?.detectedPlatform) ?? detectShortcutPlatform();
  const label = formatShortcutLabel(binding.primary, platform);
  if (!hintsEnabled || !label) return null;
  return <span className={props.className}>{label}</span>;
}

/** Files is a Space page too, so Space shortcuts stay on there. */
function inScope(scope: ShortcutScope, activeScope: ShortcutScope): boolean {
  return scope === activeScope || (scope === "tool:space" && activeScope === "tool:library");
}

function scopeIsActive(scope: ShortcutScope, activeScope: ShortcutScope): boolean {
  return scope === "global" || scope === "workspace" || inScope(scope, activeScope);
}

function scopeRank(scope: ShortcutScope, activeScope: ShortcutScope): number {
  if (inScope(scope, activeScope) && scope.startsWith("tool:")) return 3;
  if (scope === "workspace") return 2;
  return 1;
}
