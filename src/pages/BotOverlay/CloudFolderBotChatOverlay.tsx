import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import {
  cloudFolderBotContextEvent,
  publishCloudFolderBotChatVisibility,
  requestCloudFolderBotContext,
  setCloudFolderBotWindowVisible,
  type CloudFolderBotContext,
} from "../../bots/cloudFolderBot";
import { hasTauriInternals } from "../../shared/tauri";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { ExplorerMikaPanel } from "../Files/desktop/ExplorerAssistantPanels";

const chatFadeMs = 420;

export default function CloudFolderBotChatOverlay() {
  const [visible, setVisible] = useState(true);
  const [mikaContext, setMikaContext] = useState<CloudFolderBotContext>({
    workingDirectory: "",
    selectedPaths: [],
  });
  const closingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const appRoot = document.getElementById("root");
    const previous = {
      rootBackground: root.style.background,
      bodyBackground: body.style.background,
      appRootBackground: appRoot?.style.background ?? "",
    };
    root.style.background = "transparent";
    body.style.background = "transparent";
    if (appRoot) appRoot.style.background = "transparent";

    return () => {
      root.style.background = previous.rootBackground;
      body.style.background = previous.bodyBackground;
      if (appRoot) appRoot.style.background = previous.appRootBackground;
    };
  }, []);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    const chatWindow = getCurrentWindow();
    void chatWindow.setResizable(false).catch(() => undefined);
    void chatWindow.setMaximizable(false).catch(() => undefined);
    void clampChatWindowToScreen();
    let unlisten: UnlistenFn | null = null;
    void listen<CloudFolderBotContext>(cloudFolderBotContextEvent, (event) => {
      setMikaContext(event.payload);
    }).then((listener) => {
      unlisten = listener;
    });
    void requestCloudFolderBotContext();
    void useSettingsStore.getState().load();
    void publishCloudFolderBotChatVisibility(true);
    return () => {
      if (unlisten) void unlisten();
      void publishCloudFolderBotChatVisibility(false);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  const closeChat = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      void (async () => {
        await publishCloudFolderBotChatVisibility(false);
        await setCloudFolderBotWindowVisible(true);
        if (hasTauriInternals()) await getCurrentWindow().close().catch(() => undefined);
      })();
    }, chatFadeMs);
  }, []);

  const startDragging = useCallback(() => {
    if (!hasTauriInternals()) return;
    void getCurrentWindow()
      .startDragging()
      .finally(() => clampChatWindowToScreen())
      .catch(() => undefined);
  }, []);

  return (
    <main className="pointer-events-none relative h-screen w-screen overflow-hidden bg-transparent">
      <div
        className={`absolute inset-0 origin-bottom-right [backface-visibility:hidden] [transform:translate3d(0,0,0)] transition-[opacity,transform] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[opacity,transform] motion-reduce:transition-none ${visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-[0.985] opacity-0"}`}
      >
        <ExplorerMikaPanel
          surface="bot-chat-window"
          onHeaderDragStart={startDragging}
          workingDirectory={mikaContext.workingDirectory}
          selectedPaths={mikaContext.selectedPaths}
          onClose={closeChat}
        />
      </div>
    </main>
  );
}

async function clampChatWindowToScreen(): Promise<void> {
  const chatWindow = getCurrentWindow();
  const [position, size, monitor] = await Promise.all([
    chatWindow.outerPosition(),
    chatWindow.outerSize(),
    currentMonitor().then((current) => current ?? primaryMonitor()),
  ]).catch(() => [null, null, null] as const);
  if (!position || !size || !monitor) return;

  const minX = monitor.workArea.position.x;
  const minY = monitor.workArea.position.y;
  const maxX = Math.max(minX, minX + monitor.workArea.size.width - size.width);
  const maxY = Math.max(minY, minY + monitor.workArea.size.height - size.height);
  const x = Math.min(Math.max(position.x, minX), maxX);
  const y = Math.min(Math.max(position.y, minY), maxY);
  if (x === position.x && y === position.y) return;
  await chatWindow.setPosition(new PhysicalPosition(x, y)).catch(() => undefined);
}
