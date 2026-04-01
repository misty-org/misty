import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { listen } from "@tauri-apps/api/event";
import {
  currentMonitor,
  getCurrentWindow,
  primaryMonitor,
} from "@tauri-apps/api/window";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { AppWindow, ArrowUpRight, MessageSquare, X } from "lucide-react";
import botHappy from "../../assets/bots/cloud-folder/happy.png";
import botIdle from "../../assets/bots/cloud-folder/idle.png";
import botSleep from "../../assets/bots/cloud-folder/sleep.png";
import {
  cloudFolderBotBubbleTransitionMs,
  cloudFolderBotChatWindowSize,
  cloudFolderBotContextEvent,
  cloudFolderBotNotifyEvent,
  cloudFolderBotWindowSize,
  dismissCloudFolderBotFromOverlay,
  requestCloudFolderBotContext,
  returnToMistyAppFromBot,
  type CloudFolderBotContext,
  type CloudFolderBotNotification,
} from "../../bots/cloudFolderBot";
import { hasTauriInternals, safeTauriAssetUrl } from "../../shared/tauri";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { ExplorerMikaPanel } from "../Files/desktop/ExplorerAssistantPanels";

type BotMood = "idle" | "sleep" | "happy";
type BotContextMenu = { x: number; y: number };
type BubblePlacement = "above" | "below";

const expressionCycleMs = 1800;
const botContextMenuSize = { width: 156, height: 126 };
const contextMenuClass =
  "pointer-events-auto absolute z-40 grid w-[156px] overflow-hidden rounded-[11px] border border-white/10 bg-[rgba(5,6,7,0.98)] p-1.5 text-[13px] font-medium text-[#e4e4e7] shadow-[0_18px_40px_rgba(0,0,0,0.45)]";
const contextMenuItemClass =
  "grid h-9 w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 text-left text-[#e4e4e7] transition hover:bg-white/[0.06] hover:text-[#f4f4f5]";
const bubbleToggleCooldownMs = 420;
const bubbleShowDelayMs = 140;
const botActiveIdleMs = 2400;
const botSpriteHeight = 122;
const botSpriteSlotOffset = 62;
const expressionCycle: BotMood[] = ["idle", "sleep", "idle", "happy"];

export default function CloudFolderBotOverlay() {
  const [moodIndex, setMoodIndex] = useState(0);
  const [notification, setNotification] =
    useState<CloudFolderBotNotification | null>(null);
  const [botActive, setBotActive] = useState(false);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [bubbleToggleLocked, setBubbleToggleLocked] = useState(false);
  const [bubblePlacement, setBubblePlacement] =
    useState<BubblePlacement>("above");
  const [contextMenu, setContextMenu] = useState<BotContextMenu | null>(null);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [mikaContext, setMikaContext] = useState<CloudFolderBotContext>({
    workingDirectory: "",
    selectedPaths: [],
  });
  const botAssets = useMemo(() => cloudFolderBotAssetSources(), []);
  const bubbleToggleTimerRef = useRef<number | null>(null);
  const bubbleSequenceTimerRef = useRef<number | null>(null);
  const botActiveTimerRef = useRef<number | null>(null);
  const bubblePlacementRef = useRef<BubblePlacement>("above");
  const mood = expressionCycle[moodIndex] ?? "idle";
  const notificationCount = notification ? 1 : 0;
  const badgeVisible = botActive || bubbleVisible;

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
    void useSettingsStore.getState().load();
  }, []);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    let unlisten: UnlistenFn | null = null;
    void listen<CloudFolderBotNotification>(
      cloudFolderBotNotifyEvent,
      (event) => {
        setNotification(event.payload);
      },
    ).then((listener) => {
      unlisten = listener;
    });

    return () => {
      if (unlisten) void unlisten();
    };
  }, []);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    let unlisten: UnlistenFn | null = null;
    void listen<CloudFolderBotContext>(cloudFolderBotContextEvent, (event) => {
      setMikaContext(event.payload);
    }).then((listener) => {
      unlisten = listener;
    });
    return () => {
      if (unlisten) void unlisten();
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setMoodIndex((current) => (current + 1) % expressionCycle.length);
    }, expressionCycleMs);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("blur", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("blur", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (botActiveTimerRef.current !== null) {
      window.clearTimeout(botActiveTimerRef.current);
      botActiveTimerRef.current = null;
    }
    if (!botActive || bubbleVisible || contextMenu) return;

    botActiveTimerRef.current = window.setTimeout(() => {
      botActiveTimerRef.current = null;
      deactivateBot();
    }, botActiveIdleMs);

    return () => {
      if (botActiveTimerRef.current !== null) {
        window.clearTimeout(botActiveTimerRef.current);
        botActiveTimerRef.current = null;
      }
    };
  }, [bubbleVisible, contextMenu, botActive]);

  useEffect(() => {
    return () => {
      if (bubbleToggleTimerRef.current !== null) {
        window.clearTimeout(bubbleToggleTimerRef.current);
      }
      if (bubbleSequenceTimerRef.current !== null) {
        window.clearTimeout(bubbleSequenceTimerRef.current);
      }
      if (botActiveTimerRef.current !== null) {
        window.clearTimeout(botActiveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    const botWindow = getCurrentWindow();
    let clampTimer: number | null = null;
    let unlisten: UnlistenFn | null = null;
    const scheduleClamp = () => {
      if (clampTimer !== null) window.clearTimeout(clampTimer);
      clampTimer = window.setTimeout(() => {
        clampTimer = null;
        void settleBotWindow(bubblePlacementRef, setBubblePlacement);
      }, 160);
    };

    void settleBotWindow(bubblePlacementRef, setBubblePlacement);
    void botWindow.onMoved(scheduleClamp).then((listener) => {
      unlisten = listener;
    });

    return () => {
      if (clampTimer !== null) window.clearTimeout(clampTimer);
      if (unlisten) void unlisten();
    };
  }, []);

  const imageSrc = useMemo(() => {
    if (mood === "happy") return botAssets.happy;
    if (mood === "idle") return botAssets.idle;
    return botAssets.sleep;
  }, [mood, botAssets.happy, botAssets.idle, botAssets.sleep]);

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    activateBot();
    setContextMenu(null);
    if (!hasTauriInternals()) return;
    void getCurrentWindow()
      .startDragging()
      .finally(() => {
        void settleBotWindow(bubblePlacementRef, setBubblePlacement);
      })
      .catch(() => undefined);
  };

  const toggleChat = () => {
    if (bubbleToggleLocked) return;
    activateBot();
    setBubbleToggleLocked(true);
    if (bubbleSequenceTimerRef.current !== null) {
      window.clearTimeout(bubbleSequenceTimerRef.current);
      bubbleSequenceTimerRef.current = null;
    }

    if (bubbleVisible) {
      setBubbleVisible(false);
    } else {
      setBubbleVisible(false);
      bubbleSequenceTimerRef.current = window.setTimeout(() => {
        bubbleSequenceTimerRef.current = null;
        setBubbleVisible(true);
      }, bubbleShowDelayMs);
    }

    if (bubbleToggleTimerRef.current !== null) {
      window.clearTimeout(bubbleToggleTimerRef.current);
    }
    bubbleToggleTimerRef.current = window.setTimeout(() => {
      bubbleToggleTimerRef.current = null;
      setBubbleToggleLocked(false);
    }, bubbleToggleCooldownMs);
  };

  const activateBot = () => {
    setBotActive(true);
    if (botActiveTimerRef.current !== null) {
      window.clearTimeout(botActiveTimerRef.current);
      botActiveTimerRef.current = null;
    }
  };

  const deactivateBot = () => {
    setBotActive(false);
    setBubbleVisible(false);
    if (bubbleSequenceTimerRef.current !== null) {
      window.clearTimeout(bubbleSequenceTimerRef.current);
    }
    bubbleSequenceTimerRef.current = window.setTimeout(() => {
      bubbleSequenceTimerRef.current = null;
    }, cloudFolderBotBubbleTransitionMs);
  };

  const returnToApp = () => {
    setContextMenu(null);
    void returnToMistyAppFromBot();
  };

  const openAssistant = () => {
    setContextMenu(null);
    if (chatExpanded) return;
    setChatExpanded(true);
    setBubbleVisible(false);
    setBubblePlacement("above");
    bubblePlacementRef.current = "above";
    void resizeBotWindow(true);
    void requestCloudFolderBotContext();
  };

  const closeAssistant = () => {
    setChatExpanded(false);
    setContextMenu(null);
    void resizeBotWindow(false);
  };

  const closeBot = () => {
    setContextMenu(null);
    void dismissCloudFolderBotFromOverlay();
  };

  const openContextMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    activateBot();
    const x = Math.max(
      4,
      Math.min(event.clientX, window.innerWidth - botContextMenuSize.width - 4),
    );
    const y = Math.max(
      4,
      Math.min(event.clientY, window.innerHeight - botContextMenuSize.height - 4),
    );
    setContextMenu({ x, y });
  };

  return (
    <main
      className="pointer-events-none relative h-screen w-screen select-none overflow-hidden bg-transparent text-[#17202a]"
    >
      {badgeVisible && !chatExpanded ? (
        <button
          aria-label={
            bubbleVisible ? "Hide Mika notifications" : "Show Mika notifications"
          }
          aria-disabled={bubbleToggleLocked}
          className={`pointer-events-auto absolute right-1 z-30 grid h-7 min-w-7 place-items-center rounded-full border border-[#a3e8ad] bg-[#79d98b] px-2 text-[13px] font-bold leading-none text-[#0d2a14] opacity-100 shadow-[0_8px_18px_rgba(0,0,0,0.24)] transition-[opacity,transform] ${bubblePlacement === "above" ? "bottom-[94px]" : "top-0"} ${bubbleToggleLocked ? "cursor-default opacity-90" : ""}`}
          onClick={toggleChat}
          title={bubbleToggleLocked ? undefined : bubbleVisible ? "Hide notifications" : "Show notifications"}
          type="button"
        >
          {notificationCount > 0 ? (
            formatNotificationCount(notificationCount)
          ) : (
            <span
              className="grid size-1.5 place-items-center rounded-full bg-current"
              aria-hidden="true"
            />
          )}
        </button>
      ) : null}

      {bubbleVisible && !chatExpanded ? (
        <aside
          className={`pointer-events-auto absolute left-1 right-1 z-20 h-[48px] rounded-[14px] border border-white bg-white px-2.5 py-2 text-[#17202a] shadow-[0_16px_34px_rgba(0,0,0,0.24)] after:absolute after:left-1/2 after:h-3.5 after:w-3.5 after:-translate-x-1/2 after:rotate-45 after:border-white after:bg-white after:content-[''] ${bubblePlacement === "above" ? "top-0 after:bottom-[-7px] after:border-b after:border-r" : "bottom-0 after:top-[-7px] after:border-l after:border-t"}`}
          role="log"
          aria-live="polite"
        >
          <button
            aria-label="Return to Misty"
            className="absolute right-2 top-2 z-10 grid size-6 place-items-center rounded-full border-0 bg-[#e7f8ee] p-0 text-[#1f6f36] transition hover:bg-[#d2f3df]"
            onClick={returnToApp}
            title="Return to Misty"
            type="button"
          >
            <ArrowUpRight aria-hidden="true" size={14} strokeWidth={2.5} />
          </button>
          {notification ? (
            <article
              className={`truncate rounded-[10px] px-2.5 py-1.5 pr-7 text-[11px] font-semibold leading-snug ${
                notification.type === "error"
                  ? "bg-[#fff1f2] text-[#7f1d1d]"
                  : "bg-[#edf8ff] text-[#17334a]"
              }`}
            >
              {notification.message}
            </article>
          ) : (
            <div className="truncate rounded-[10px] bg-[#edf8ff] px-2.5 py-2 pr-7 text-[11px] font-semibold leading-snug text-[#426270]">
              Nothing going on.
            </div>
          )}
        </aside>
      ) : null}

      {chatExpanded ? (
        <ExplorerMikaPanel
          surface="bot-window"
          workingDirectory={mikaContext.workingDirectory}
          selectedPaths={mikaContext.selectedPaths}
          onClose={closeAssistant}
        />
      ) : null}

      <button
        aria-label="Ask Mika; drag to move"
        className={`pointer-events-auto absolute left-1/2 z-30 grid h-[122px] w-[150px] -translate-x-1/2 cursor-grab place-items-center border-0 bg-transparent p-0 active:cursor-grabbing ${chatExpanded || bubblePlacement === "above" ? "bottom-0" : "top-0"}`}
        onPointerDown={startDrag}
        onClick={openAssistant}
        onContextMenu={openContextMenu}
        type="button"
      >
        <img
          alt=""
          className="h-full w-full select-none object-contain drop-shadow-[0_10px_18px_rgba(18,92,150,0.2)]"
          draggable={false}
          src={imageSrc}
        />
      </button>

      {contextMenu ? (
        <div
          className={contextMenuClass}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className={contextMenuItemClass}
            onClick={openAssistant}
            role="menuitem"
            type="button"
          >
            <MessageSquare className="text-[#a1a1aa]" aria-hidden="true" size={16} />
            <span className="truncate">Ask Mika</span>
          </button>
          <button
            className={contextMenuItemClass}
            onClick={returnToApp}
            role="menuitem"
            type="button"
          >
            <AppWindow className="text-[#a1a1aa]" aria-hidden="true" size={16} />
            <span className="truncate">Open Misty</span>
          </button>
          <button
            className={`${contextMenuItemClass} text-[#f87171] hover:bg-[#ef4444]/10 hover:text-[#fca5a5]`}
            onClick={closeBot}
            role="menuitem"
            type="button"
          >
            <X className="text-current" aria-hidden="true" size={16} />
            <span className="truncate">Close Mika</span>
          </button>
        </div>
      ) : null}
    </main>
  );
}

function cloudFolderBotAssetSources(): {
  idle: string;
  sleep: string;
  happy: string;
} {
  const assetsDir = new URLSearchParams(window.location.search)
    .get("assetsDir")
    ?.trim();
  if (!assetsDir) {
    return { idle: botIdle, sleep: botSleep, happy: botHappy };
  }
  const base = assetsDir.replace(/\/+$/, "");
  return {
    idle: safeTauriAssetUrl(`${base}/animations/cloud-folder-idle.png`),
    sleep: safeTauriAssetUrl(`${base}/animations/cloud-folder-sleep.png`),
    happy: safeTauriAssetUrl(`${base}/animations/cloud-folder-happy.png`),
  };
}

function formatNotificationCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

async function resizeBotWindow(expanded: boolean): Promise<void> {
  if (!hasTauriInternals()) return;
  const botWindow = getCurrentWindow();
  const [position, currentSize, monitor] = await Promise.all([
    botWindow.outerPosition(),
    botWindow.outerSize(),
    currentMonitor().then((current) => current ?? primaryMonitor()),
  ]);
  const target = expanded ? cloudFolderBotChatWindowSize : cloudFolderBotWindowSize;
  const scaleFactor = monitor?.scaleFactor ?? 1;
  const targetWidth = Math.round(target.width * scaleFactor);
  const targetHeight = Math.round(target.height * scaleFactor);
  const nextPosition = new PhysicalPosition(
    position.x + currentSize.width - targetWidth,
    position.y + currentSize.height - targetHeight,
  );

  if (expanded) {
    await botWindow.setPosition(nextPosition);
    await botWindow.setSize(new LogicalSize(target.width, target.height));
  } else {
    await botWindow.setSize(new LogicalSize(target.width, target.height));
    await botWindow.setPosition(nextPosition);
  }
  await clampBotWindowToScreen();
}

async function clampBotWindowToScreen(): Promise<void> {
  const botWindow = getCurrentWindow();
  const [position, size, monitor] = await Promise.all([
    botWindow.outerPosition(),
    botWindow.outerSize(),
    currentMonitor().then((current) => current ?? primaryMonitor()),
  ]);
  if (!monitor) return;

  const minX = monitor.workArea.position.x;
  const minY = monitor.workArea.position.y;
  const maxX = minX + monitor.workArea.size.width - size.width;
  const maxY = minY + monitor.workArea.size.height - size.height;
  const x = Math.min(Math.max(position.x, minX), Math.max(minX, maxX));
  const y = Math.min(Math.max(position.y, minY), Math.max(minY, maxY));

  if (x !== position.x || y !== position.y) {
    await botWindow.setPosition(new PhysicalPosition(x, y));
  }
}

async function settleBotWindow(
  placementRef: { current: BubblePlacement },
  setPlacement: (placement: BubblePlacement) => void,
): Promise<void> {
  await clampBotWindowToScreen();

  const botWindow = getCurrentWindow();
  const [position, monitor] = await Promise.all([
    botWindow.outerPosition(),
    currentMonitor().then((current) => current ?? primaryMonitor()),
  ]);
  if (!monitor) return;

  const scaleFactor = monitor.scaleFactor;
  const currentPlacement = placementRef.current;
  const currentSpriteOffset =
    currentPlacement === "above" ? botSpriteSlotOffset : 0;
  const spriteCenterY =
    position.y + (currentSpriteOffset + botSpriteHeight / 2) * scaleFactor;
  const monitorCenterY =
    monitor.workArea.position.y + monitor.workArea.size.height / 2;
  const nextPlacement: BubblePlacement =
    spriteCenterY > monitorCenterY ? "above" : "below";
  if (nextPlacement === currentPlacement) return;

  const nextSpriteOffset = nextPlacement === "above" ? botSpriteSlotOffset : 0;
  const compensatedY =
    position.y + (currentSpriteOffset - nextSpriteOffset) * scaleFactor;

  placementRef.current = nextPlacement;
  setPlacement(nextPlacement);
  await botWindow.setPosition(
    new PhysicalPosition(position.x, Math.round(compensatedY)),
  );
  await clampBotWindowToScreen();
}
