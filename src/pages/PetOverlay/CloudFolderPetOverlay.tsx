import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  currentMonitor,
  getCurrentWindow,
  primaryMonitor,
} from "@tauri-apps/api/window";
import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { ArrowUpRight } from "lucide-react";
import petHappy from "../../assets/pets/cloud-folder/happy.png";
import petIdle from "../../assets/pets/cloud-folder/idle.png";
import petSleep from "../../assets/pets/cloud-folder/sleep.png";
import {
  cloudFolderPetNotifyEvent,
  cloudFolderPetChatWindowSize,
  cloudFolderPetCompactWindowSize,
  returnToMistyAppFromPet,
  type CloudFolderPetNotification,
} from "../../pets/cloudFolderPet";
import { hasTauriInternals, safeTauriAssetUrl } from "../../shared/tauri";

type PetMood = "idle" | "sleep" | "happy";

const expressionCycleMs = 1800;
const maxPetNotifications = 30;
const expressionCycle: PetMood[] = ["idle", "sleep", "idle", "happy"];

export default function CloudFolderPetOverlay() {
  const [moodIndex, setMoodIndex] = useState(0);
  const [notifications, setNotifications] = useState<CloudFolderPetNotification[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const petAssets = useMemo(() => cloudFolderPetAssetSources(), []);
  const mood = expressionCycle[moodIndex] ?? "idle";
  const notificationCount = notifications.length;

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
    let unlisten: UnlistenFn | null = null;
    void listen<CloudFolderPetNotification>(cloudFolderPetNotifyEvent, (event) => {
      setNotifications((current) => [...current, event.payload].slice(-maxPetNotifications));
    }).then((listener) => {
      unlisten = listener;
    });

    return () => {
      if (unlisten) void unlisten();
    };
  }, []);

  useEffect(() => {
    resizePetWindow(chatOpen ? cloudFolderPetChatWindowSize : cloudFolderPetCompactWindowSize);
  }, [chatOpen]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setMoodIndex((current) => (current + 1) % expressionCycle.length);
    }, expressionCycleMs);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    const petWindow = getCurrentWindow();
    let clampTimer: number | null = null;
    let unlisten: UnlistenFn | null = null;
    const scheduleClamp = () => {
      if (clampTimer !== null) window.clearTimeout(clampTimer);
      clampTimer = window.setTimeout(() => {
        clampTimer = null;
        void clampPetWindowToScreen();
      }, 160);
    };

    void clampPetWindowToScreen();
    void petWindow.onMoved(scheduleClamp).then((listener) => {
      unlisten = listener;
    });

    return () => {
      if (clampTimer !== null) window.clearTimeout(clampTimer);
      if (unlisten) void unlisten();
    };
  }, []);

  const imageSrc = useMemo(() => {
    if (mood === "happy") return petAssets.happy;
    if (mood === "idle") return petAssets.idle;
    return petAssets.sleep;
  }, [mood, petAssets.happy, petAssets.idle, petAssets.sleep]);

  const startDrag = () => {
    if (!hasTauriInternals()) return;
    void getCurrentWindow()
      .startDragging()
      .finally(() => {
        void clampPetWindowToScreen();
      })
      .catch(() => undefined);
  };

  const toggleChat = () => {
    setChatOpen((open) => !open);
  };

  const returnToApp = () => {
    void returnToMistyAppFromPet();
  };

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-transparent text-[#17202a]">
      <button
        aria-label={chatOpen ? "Hide pet notifications" : "Show pet notifications"}
        className="absolute right-0 z-30 grid h-7 min-w-7 place-items-center rounded-full border border-[#a3e8ad] bg-[#79d98b] px-2 text-[13px] font-bold leading-none text-[#0d2a14] shadow-[0_8px_18px_rgba(0,0,0,0.24)]"
        onClick={toggleChat}
        style={{
          top: chatOpen
            ? cloudFolderPetChatWindowSize.height - cloudFolderPetCompactWindowSize.height
            : 0,
        }}
        title={chatOpen ? "Hide notifications" : "Show notifications"}
        type="button"
      >
        {notificationCount > 0 ? (
          formatNotificationCount(notificationCount)
        ) : (
          <span className="grid size-3 place-items-center rounded-full bg-current" aria-hidden="true" />
        )}
      </button>

      {chatOpen ? (
        <aside
          className="absolute bottom-1.5 left-3 right-[162px] top-1.5 z-20 rounded-[14px] border border-white bg-white px-2.5 py-2 text-[#17202a] shadow-[0_16px_34px_rgba(0,0,0,0.24)] after:absolute after:right-[-7px] after:top-1/2 after:h-3.5 after:w-3.5 after:-translate-y-1/2 after:rotate-45 after:border-r after:border-t after:border-white after:bg-white after:content-['']"
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
          {notificationCount > 0 ? (
            <div className="misty-scrollbar grid max-h-[76px] gap-1 overflow-y-auto pr-7">
              {[...notifications].reverse().map((entry) => (
                <article
                  className={`rounded-[10px] px-2.5 py-1.5 text-[11px] font-semibold leading-snug ${entry.type === "error" ? "bg-[#fff1f2] text-[#7f1d1d]" : "bg-[#edf8ff] text-[#17334a]"}`}
                  key={`${entry.id}:${entry.createdAtMs}`}
                >
                  {entry.message}
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-[10px] bg-[#edf8ff] px-2.5 py-2 text-[11px] font-semibold leading-snug text-[#426270]">
              Nothing going on.
            </div>
          )}
        </aside>
      ) : null}

      <button
        aria-label="Drag desktop pet"
        className="absolute bottom-0 right-0 grid h-[122px] w-[150px] cursor-grab place-items-center border-0 bg-transparent p-0 active:cursor-grabbing"
        onPointerDown={startDrag}
        type="button"
      >
        <img
          alt=""
          className="h-full w-full select-none object-contain drop-shadow-[0_10px_18px_rgba(18,92,150,0.2)]"
          draggable={false}
          src={imageSrc}
        />
      </button>
    </main>
  );
}

function cloudFolderPetAssetSources(): { idle: string; sleep: string; happy: string } {
  const assetsDir = new URLSearchParams(window.location.search).get("assetsDir")?.trim();
  if (!assetsDir) {
    return { idle: petIdle, sleep: petSleep, happy: petHappy };
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

async function clampPetWindowToScreen(): Promise<void> {
  const petWindow = getCurrentWindow();
  const [position, size, monitor] = await Promise.all([
    petWindow.outerPosition(),
    petWindow.outerSize(),
    currentMonitor().then((current) => current ?? primaryMonitor()),
  ]);
  if (!monitor) return;

  const minX = monitor.workArea.position.x;
  const minY = monitor.workArea.position.y;
  const maxX = minX + monitor.workArea.size.width - size.width;
  const maxY = minY + monitor.workArea.size.height - size.height;
  const x = Math.min(Math.max(position.x, minX), Math.max(minX, maxX));
  const y = Math.min(Math.max(position.y, minY), Math.max(minY, maxY));

  if (x === position.x && y === position.y) return;
  await petWindow.setPosition(new PhysicalPosition(x, y));
}

function resizePetWindow(size: { width: number; height: number }): void {
  if (!hasTauriInternals()) return;
  void resizePetWindowAnchored(size)
    .catch(() => undefined);
}

async function resizePetWindowAnchored(size: { width: number; height: number }): Promise<void> {
  const petWindow = getCurrentWindow();
  const [position, currentSize, monitor] = await Promise.all([
    petWindow.outerPosition(),
    petWindow.outerSize(),
    currentMonitor().then((current) => current ?? primaryMonitor()),
  ]);
  const scaleFactor = monitor?.scaleFactor ?? 1;
  const nextWidth = Math.round(size.width * scaleFactor);
  const nextHeight = Math.round(size.height * scaleFactor);

  await petWindow.setPosition(
    new PhysicalPosition(
      position.x + currentSize.width - nextWidth,
      position.y + currentSize.height - nextHeight,
    ),
  );
  await petWindow.setSize(new LogicalSize(size.width, size.height));
  await clampPetWindowToScreen();
}
