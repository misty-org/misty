import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { useSettingsStore } from "@/features/settings";
import { dispatchShortcutEvent, invokeShortcutCommand } from "@/features/shortcuts";
import { hasTauriInternals } from "@/shared/platform/tauri";

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

/** Keyboard shortcuts for the window: key presses, and the commands native menus forward. */
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
