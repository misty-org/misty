import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppWindow, Check, MousePointer2, Power, RotateCw, Settings2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { applyAppTheme } from "@/features/settings";
import {
  MenuPanel,
  MenuPanelHeader,
  MenuPanelItem,
  MenuPanelLabel,
  MenuPanelSeparator,
  MistyMark,
  StateMark,
  Text,
} from "@/shared/ui";
import type { TrayChat } from "./trayAgents";

/** What the panel shows (`src-tauri/features/app/tray_panel.rs`). */
interface TrayPanelState {
  version: string;
  /** Absent until a main window says what Tutor is. */
  tutor: { on: boolean; ready: boolean } | null;
  chats: TrayChat[];
}

const empty: TrayPanelState = { version: "", tutor: null, chats: [] };

const press = (action: string, chat?: string) =>
  void invoke("tray_panel_press", { action, chat }).catch(() => undefined);

/**
 * The panel under Misty's menu bar icon on macOS: the chats whose agents are working or waiting
 * on the person, Tutor, and opening or quitting Misty. It is its own window, which sizes itself
 * to what it shows and closes when the person clicks anywhere else.
 */
export function TrayPanel() {
  const [state, setState] = useState(empty);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    let updated = false;
    const remove = getCurrentWindow().listen<TrayPanelState>("misty://tray-panel", (event) => {
      updated = true;
      if (live) setState(event.payload);
    });
    void remove
      .then(() => invoke<TrayPanelState>("tray_panel_state"))
      .then((snapshot) => {
        if (live && !updated) setState(snapshot);
      })
      .catch(() => undefined);
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") press("close");
    };
    window.addEventListener("keydown", close);
    return () => {
      live = false;
      window.removeEventListener("keydown", close);
      void remove.then((stop) => stop());
    };
  }, []);

  // Like the menu bar it hangs from, the panel follows the Mac's appearance.
  useLayoutEffect(() => {
    applyAppTheme("system");
    const query = window.matchMedia?.("(prefers-color-scheme: light)");
    const follow = () => applyAppTheme("system");
    query?.addEventListener("change", follow);
    return () => query?.removeEventListener("change", follow);
  }, []);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const fit = () =>
      void invoke("tray_panel_fit", { height: element.offsetHeight }).catch(() => undefined);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { tutor, chats } = state;
  return (
    <MenuPanel ref={panel} aria-label="Misty">
      <MenuPanelHeader
        mark={<MistyMark className="size-5" />}
        title="Misty"
        detail={state.version || undefined}
      />
      <MenuPanelSeparator />
      <MenuPanelLabel>Agents</MenuPanelLabel>
      {chats.length ? (
        chats.map((chat) => (
          <MenuPanelItem
            key={chat.id}
            label={chat.title || "New chat"}
            description={chat.agentName}
            state={<StateMark kind={chat.status === "working" ? "working" : "waiting"} />}
            onSelect={() => press("chat", chat.id)}
          />
        ))
      ) : (
        <Text size="control" tone="muted" className="px-2 pb-1.5">
          None at work right now
        </Text>
      )}
      {tutor ? (
        <>
          <MenuPanelSeparator />
          {tutor.ready ? (
            <MenuPanelItem
              icon={MousePointer2}
              label="Tutor"
              checked={tutor.on}
              state={tutor.on ? <Check aria-hidden className="size-4" /> : undefined}
              onSelect={() => press("tutor")}
            />
          ) : (
            <MenuPanelItem
              icon={MousePointer2}
              label="Set up Tutor"
              onSelect={() => press("tutor-settings")}
            />
          )}
          {tutor.ready ? (
            <MenuPanelItem
              icon={Settings2}
              label="Tutor settings"
              onSelect={() => press("tutor-settings")}
            />
          ) : null}
        </>
      ) : null}
      <MenuPanelSeparator />
      <MenuPanelItem icon={AppWindow} label="Open Misty" onSelect={() => press("open")} />
      <MenuPanelItem icon={RotateCw} label="Restart Misty" onSelect={() => press("restart")} />
      <MenuPanelItem icon={Power} label="Quit Misty" shortcut="⌘Q" onSelect={() => press("quit")} />
    </MenuPanel>
  );
}
