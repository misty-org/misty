import { settingsBoolean, useSettingsStore } from "@/features/settings";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { cn } from "@/shared/ui";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, type ReactNode } from "react";
import {
  bindingPairMatchesEvent,
  detectShortcutPlatform,
  formatShortcut,
  formatShortcutLabel,
  isEditableShortcutTarget,
} from "./bindings";
import {
  defaultBindingsFor,
  shortcutCommandsById,
  shortcutCommandRegistry,
  type ShortcutCommandDefinition,
  type ShortcutScope,
} from "./registry";

export interface ShortcutInvocation {
  command: ShortcutCommandDefinition;
  event: KeyboardEvent;
  scope: ShortcutScope;
}

export type ShortcutHandler = (invocation: ShortcutInvocation) => boolean | void;

interface HandlerRegistration {
  token: symbol;
  handler: ShortcutHandler;
  enabled: () => boolean;
}

interface ForwardedShortcutEvent {
  id: string;
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  editable: boolean;
}

const handlers = new Map<string, HandlerRegistration[]>();
export function registerShortcutHandler(
  commandId: string,
  handler: ShortcutHandler,
  enabled: () => boolean = () => true,
): () => void {
  const registration = { token: Symbol(commandId), handler, enabled };
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
      ),
    [commandId],
  );
}

export function ShortcutRuntime(): null {
  useEffect(() => {
    const dispatch = (event: KeyboardEvent) => dispatchShortcutEvent(event);
    window.addEventListener("keydown", dispatch, true);
    return () => window.removeEventListener("keydown", dispatch, true);
  }, []);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    let disposed = false;
    const unlisten: Array<() => void> = [];
    void Promise.all([
      listen("misty://shortcuts-changed", () => {
        void useSettingsStore.getState().load();
      }),
      listen<string>("misty://shortcut-command", (event) => {
        invokeShortcutCommand(event.payload);
      }),
      listen<ForwardedShortcutEvent>("misty://browser-shortcut", (event) => {
        const forwarded = event.payload;
        dispatchShortcutEvent(
          new KeyboardEvent("keydown", {
            key: forwarded.key,
            code: forwarded.code,
            altKey: forwarded.altKey,
            ctrlKey: forwarded.ctrlKey,
            metaKey: forwarded.metaKey,
            shiftKey: forwarded.shiftKey,
            repeat: forwarded.repeat,
            cancelable: true,
          }),
          forwarded.editable,
        );
      }),
    ]).then((next) => {
      if (disposed) next.forEach((remove) => remove());
      else unlisten.push(...next);
    });
    return () => {
      disposed = true;
      unlisten.forEach((remove) => remove());
    };
  }, []);

  return null;
}

export function dispatchShortcutEvent(event: KeyboardEvent, editableOverride?: boolean): boolean {
  if (event.defaultPrevented || document.documentElement.dataset.shortcutCapture === "true")
    return false;
  const activeScope = focusedShortcutScope();
  const editable = editableOverride ?? isEditableShortcutTarget(event.target);
  const target = event.target instanceof Element ? event.target : document.activeElement;
  const snapshot = useSettingsStore.getState().shortcuts;
  const platform = snapshot?.detectedPlatform ?? detectShortcutPlatform();
  const effectiveById = new Map(
    snapshot?.effectiveBindings.map((binding) => [binding.commandId, binding]) ?? [],
  );

  const candidates = shortcutCommandRegistry
    .filter((definition) => scopeIsActive(definition.scope, activeScope))
    .filter((definition) => definition.repeatable || !event.repeat)
    .filter((definition) => definition.allowInEditable || !editable)
    .filter((definition) => !agentChatBlocksSearch(definition.id, target, editable))
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
    const registrations = [...(handlers.get(definition.id) ?? [])].reverse();
    for (const registration of registrations) {
      if (!registration.enabled()) continue;
      event.preventDefault();
      event.stopPropagation();
      registration.handler({ command: definition, event, scope: activeScope });
      return true;
    }
  }
  return false;
}

export function invokeShortcutCommand(commandId: string): boolean {
  const definition = shortcutCommandsById.get(commandId);
  if (!definition) return false;
  const activeScope = focusedShortcutScope();
  if (!scopeIsActive(definition.scope, activeScope)) return false;
  const target = document.activeElement;
  const editable = isEditableShortcutTarget(target);
  if (
    (!definition.allowInEditable && editable) ||
    agentChatBlocksSearch(commandId, target, editable)
  )
    return false;
  const event = new KeyboardEvent("keydown", { cancelable: true });
  for (const registration of [...(handlers.get(commandId) ?? [])].reverse()) {
    if (!registration.enabled()) continue;
    registration.handler({ command: definition, event, scope: activeScope });
    return true;
  }
  return false;
}

function agentChatBlocksSearch(commandId: string, target: EventTarget | null, editable: boolean) {
  return Boolean(
    commandId === "search.toggle" &&
    editable &&
    target instanceof Element &&
    target.closest("[data-misty-agent-chat]"),
  );
}

export function effectiveShortcut(commandId: string): {
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

export function useEffectiveShortcut(commandId: string) {
  useSettingsStore((state) => state.shortcuts);
  return effectiveShortcut(commandId);
}

export function useShortcutTitle(label: string, commandId: string): string {
  const binding = useEffectiveShortcut(commandId);
  const hintsEnabled = useSettingsStore((state) =>
    settingsBoolean(state.settings?.document ?? {}, "shortcuts", "shortcut_hints_enabled", true),
  );
  const platform =
    useSettingsStore((state) => state.shortcuts?.detectedPlatform) ?? detectShortcutPlatform();
  const shortcutLabel = formatShortcutLabel(binding.primary, platform);
  return hintsEnabled && shortcutLabel ? `${label} (${shortcutLabel})` : label;
}

export function ShortcutHint(props: {
  commandId: string;
  className?: string;
  includeAlternate?: boolean;
  fallback?: ReactNode;
}) {
  const hintsEnabled = useSettingsStore((state) =>
    settingsBoolean(state.settings?.document ?? {}, "shortcuts", "shortcut_hints_enabled", true),
  );
  const binding = useEffectiveShortcut(props.commandId);
  const platform =
    useSettingsStore((state) => state.shortcuts?.detectedPlatform) ?? detectShortcutPlatform();
  const shortcuts = [binding.primary, props.includeAlternate ? binding.alternate : null].filter(
    (value): value is string => Boolean(value),
  );
  if (!hintsEnabled || !shortcuts.length) return <>{props.fallback ?? null}</>;
  return (
    <span className={props.className} aria-label={shortcuts.join(" or ")}>
      {shortcuts.map((shortcut, shortcutIndex) => (
        <span key={shortcut} className="inline-flex items-center gap-0.5">
          {shortcutIndex > 0 ? <span className="px-1 text-mist-gray">or</span> : null}
          {formatShortcut(shortcut, platform).map((keycap) => (
            <kbd
              key={`${shortcut}:${keycap}`}
              className={cn(
                "inline-flex min-w-5 items-center justify-center rounded border border-white/15",
                "bg-white/5 px-1 py-0.5 font-sans text-[10px] leading-none text-mist-gray",
              )}
            >
              {keycap}
            </kbd>
          ))}
        </span>
      ))}
    </span>
  );
}

function focusedShortcutScope(): ShortcutScope {
  const { layout } = useWorkspaceStore.getState();
  const pane = dockLeaves(layout.root).find((candidate) => candidate.id === layout.focusedPaneId);
  const tab = pane?.tabs.find((candidate) => candidate.id === pane.activeTabId);
  switch (tab?.surfaceId) {
    case "browser":
      return "tool:browser";
    case "code":
      return "tool:code";
    case "files":
      return "tool:files";
    case "terminal":
      return "tool:terminal";
    case "space": {
      const route = tab.route.toLowerCase();
      if (route.includes("/planner")) return "tool:planner";
      if (route.includes("/roadmap")) return "tool:roadmap";
      if (route.includes("/library")) return "tool:library";
      return "workspace";
    }
    default:
      return "workspace";
  }
}

function scopeIsActive(scope: ShortcutScope, activeScope: ShortcutScope): boolean {
  return scope === "global" || scope === "workspace" || scope === activeScope;
}

function scopeRank(scope: ShortcutScope, activeScope: ShortcutScope): number {
  if (scope === activeScope && scope.startsWith("tool:")) return 3;
  if (scope === "workspace") return 2;
  return 1;
}
