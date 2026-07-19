import { useEffect, useMemo, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { AppWindow, ArrowUpRight, MessageSquare, X } from "lucide-react";
import { motion, useMotionValue, useSpring } from "motion/react";
import {
  cloudFolderBotChatVisibilityEvent,
  cloudFolderBotNotifyEvent,
  dismissCloudFolderBotFromOverlay,
  openMikaAssistantFromBot,
  positionCloudFolderBotChatWindow,
  returnToMistyAppFromBot,
  type CloudFolderBotNotification,
  type CloudFolderBotChatVisibility,
} from "../../bots/cloudFolderBot";
import { hasTauriInternals } from "../../shared/tauri";
import {
  hideRuntimeAssetOnError,
  revealRuntimeAssetOnLoad,
  runtimeAssetSource,
} from "../../shared/assets/runtimeAsset";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { Button } from "../../components/ui/button";

type BotContextMenu = { x: number; y: number };
type MikaNativeVelocity = { velocityX: number; velocityY: number };

const botContextMenuSize = { width: 156, height: 84 };
const contextMenuClass =
  "pointer-events-auto absolute z-40 grid w-[156px] overflow-hidden rounded-[11px] border border-white/10 bg-[rgba(5,6,7,0.98)] p-1.5 text-[13px] font-medium text-[#e4e4e7] shadow-[0_18px_40px_rgba(0,0,0,0.45)]";
const contextMenuItemClass =
  "grid h-9 w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 text-left text-[#e4e4e7] transition hover:bg-white/[0.06] hover:text-[#f4f4f5]";
export default function CloudFolderBotOverlay() {
  const [notification, setNotification] =
    useState<CloudFolderBotNotification | null>(null);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [chatMode, setChatMode] = useState(false);
  const [contextMenu, setContextMenu] = useState<BotContextMenu | null>(null);
  const botAsset = useMemo(() => cloudFolderBotAssetSource(), []);
  const spriteRotationTarget = useMotionValue(0);
  const spriteOffsetTarget = useMotionValue(0);
  const spriteScaleXTarget = useMotionValue(1);
  const spriteScaleYTarget = useMotionValue(1);
  const spriteRotation = useSpring(spriteRotationTarget, { stiffness: 310, damping: 22 });
  const spriteOffset = useSpring(spriteOffsetTarget, { stiffness: 340, damping: 25 });
  const spriteScaleX = useSpring(spriteScaleXTarget, { stiffness: 360, damping: 26 });
  const spriteScaleY = useSpring(spriteScaleYTarget, { stiffness: 360, damping: 26 });
  const bubbleShown = bubbleVisible;

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
    const botWindow = getCurrentWindow();
    void botWindow.setResizable(false).catch(() => undefined);
    void botWindow.setMaximizable(false).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    let unlisten: UnlistenFn | null = null;
    void listen<CloudFolderBotChatVisibility>(
      cloudFolderBotChatVisibilityEvent,
      (event) => setChatMode(event.payload.visible),
    ).then((listener) => {
      unlisten = listener;
    });
    return () => {
      if (unlisten) void unlisten();
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
        setBubbleVisible(true);
      },
    ).then((listener) => {
      unlisten = listener;
    });

    return () => {
      if (unlisten) void unlisten();
    };
  }, []);

  useEffect(() => {
    const image = new Image();
    image.decoding = "async";
    image.src = botAsset;
    void image.decode().catch(() => undefined);
  }, [botAsset]);

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
    if (!hasTauriInternals()) return;
    let unlisten: UnlistenFn | null = null;
    void listen<MikaNativeVelocity>("mika-native-physics-velocity", (event) => {
      applySpriteVelocity(event.payload.velocityX, event.payload.velocityY);
    }).then((listener) => {
      unlisten = listener;
    });
    return () => {
      if (unlisten) void unlisten();
    };
  }, []);

  useEffect(() => {
    if (!chatMode) return;
    resetSpritePhysics();
    if (hasTauriInternals()) void invoke("cancel_mika_momentum");
  }, [chatMode]);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    const botWindow = getCurrentWindow();
    let clampTimer: number | null = null;
    let unlisten: UnlistenFn | null = null;
    const scheduleClamp = () => {
      if (clampTimer !== null) window.clearTimeout(clampTimer);
      clampTimer = window.setTimeout(() => {
        clampTimer = null;
        void clampBotWindowToScreen().then(positionCloudFolderBotChatWindow);
      }, 160);
    };

    void clampBotWindowToScreen();
    void botWindow.onMoved(scheduleClamp).then((listener) => {
      unlisten = listener;
    });

    return () => {
      if (clampTimer !== null) window.clearTimeout(clampTimer);
      if (unlisten) void unlisten();
    };
  }, []);

  const resetSpritePhysics = () => {
    spriteRotationTarget.set(0);
    spriteOffsetTarget.set(0);
    spriteScaleXTarget.set(1);
    spriteScaleYTarget.set(1);
  };

  const applySpriteVelocity = (velocityX: number, velocityY: number) => {
    const speed = Math.min(1, Math.hypot(velocityX, velocityY) / 4_800);
    spriteRotationTarget.set(clampValue(velocityX / 125, -28, 28));
    spriteOffsetTarget.set(clampValue(velocityY / 375, -8, 8));
    spriteScaleXTarget.set(1 - speed * 0.075);
    spriteScaleYTarget.set(1 + speed * 0.12);
  };

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setContextMenu(null);
    if (!hasTauriInternals()) return;
    resetSpritePhysics();
    void invoke("start_mika_drag")
      .catch(() => undefined)
      .finally(() => {
        void clampBotWindowToScreen().then(positionCloudFolderBotChatWindow);
      });
  };

  const returnToApp = () => {
    setContextMenu(null);
    void returnToMistyAppFromBot();
  };

  const openAssistant = () => {
    setContextMenu(null);
    setBubbleVisible(false);
    setChatMode(true);
    void openMikaAssistantFromBot();
  };

  const closeBot = () => {
    setContextMenu(null);
    void dismissCloudFolderBotFromOverlay();
  };

  const openContextMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
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
      {!chatMode ? (
        <div className="pointer-events-auto absolute right-0 top-2 z-40 flex w-6 flex-col items-center gap-1">
          <Button
            aria-label="Open Mika chat"
            className="grid size-5 place-items-center border-0 bg-transparent p-0 text-[#f1f3f5] transition hover:scale-110 hover:text-white"
            onClick={openAssistant}
            title="Open Mika chat"
            type="button"
          >
            <MessageSquare aria-hidden="true" size={15} strokeWidth={2.2} />
          </Button>
          <Button
            aria-label="Open Misty"
            className="grid size-5 place-items-center border-0 bg-transparent p-0 text-[#f1f3f5] transition hover:scale-110 hover:text-white"
            onClick={returnToApp}
            title="Open Misty"
            type="button"
          >
            <AppWindow aria-hidden="true" size={15} strokeWidth={2.2} />
          </Button>
        </div>
      ) : null}

      <aside
        aria-hidden={!bubbleShown || chatMode}
        className={`absolute left-1 right-1 top-0 z-50 h-[48px] rounded-[14px] border border-white bg-white px-2.5 py-2 text-[#17202a] shadow-[0_16px_34px_rgba(0,0,0,0.24)] transition-[opacity,transform] duration-[600ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[opacity,transform] after:absolute after:bottom-[-7px] after:left-1/2 after:h-3.5 after:w-3.5 after:-translate-x-1/2 after:rotate-45 after:border-b after:border-r after:border-white after:bg-white after:content-[''] motion-reduce:transition-none ${bubbleShown && !chatMode ? "pointer-events-auto translate-y-0 scale-100 opacity-100" : "pointer-events-none translate-y-2 scale-[0.97] opacity-0"}`}
        role="log"
        aria-live={bubbleShown ? "polite" : "off"}
      >
          <Button
            aria-label="Return to Misty"
            className="absolute right-2 top-2 z-10 grid size-6 place-items-center rounded-full border-0 bg-[#e7f8ee] p-0 text-[#1f6f36] transition hover:bg-[#d2f3df]"
            onClick={returnToApp}
            title="Return to Misty"
            type="button"
          >
            <ArrowUpRight aria-hidden="true" size={14} strokeWidth={2.5} />
          </Button>
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

      <motion.button
        aria-label="Drag Mika to move"
        aria-hidden={chatMode}
        disabled={chatMode}
        className={`absolute bottom-0 left-0 z-30 grid h-[101px] w-[124px] touch-none place-items-center border-0 bg-transparent p-0 [backface-visibility:hidden] [contain:layout_paint] transition-[opacity,transform] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[opacity,transform] motion-reduce:transition-none ${chatMode ? "pointer-events-none translate-y-2 scale-[0.96] cursor-default opacity-0 !transition-none" : "pointer-events-auto translate-y-0 scale-100 cursor-grab opacity-100 active:cursor-grabbing"}`}
        onPointerDown={startDrag}
        onContextMenu={openContextMenu}
        type="button"
      >
        {botAsset ? (
          <motion.img
            alt=""
            aria-hidden="true"
            className="pointer-events-none h-full w-full select-none object-contain drop-shadow-[0_10px_18px_rgba(18,92,150,0.2)] [backface-visibility:hidden] will-change-transform"
            draggable={false}
            src={botAsset}
            onError={hideRuntimeAssetOnError}
            onLoad={revealRuntimeAssetOnLoad}
            style={{
              rotate: spriteRotation,
              scaleX: spriteScaleX,
              scaleY: spriteScaleY,
              y: spriteOffset,
            }}
          />
        ) : null}
      </motion.button>

      {contextMenu ? (
        <div
          className={contextMenuClass}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <Button
            className={contextMenuItemClass}
            onClick={returnToApp}
            role="menuitem"
            type="button"
          >
            <AppWindow className="text-[#a1a1aa]" aria-hidden="true" size={16} />
            <span className="truncate">Open Misty</span>
          </Button>
          <Button
            className={`${contextMenuItemClass} text-[#f87171] hover:bg-[#ef4444]/10 hover:text-[#fca5a5]`}
            onClick={closeBot}
            role="menuitem"
            type="button"
          >
            <X className="text-current" aria-hidden="true" size={16} />
            <span className="truncate">Close Mika</span>
          </Button>
        </div>
      ) : null}
    </main>
  );
}

function cloudFolderBotAssetSource(): string {
  const assetsDir = new URLSearchParams(window.location.search)
    .get("assetsDir")
    ?.trim();
  return runtimeAssetSource(assetsDir, "animations/mika.webp");
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

function clampValue(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
