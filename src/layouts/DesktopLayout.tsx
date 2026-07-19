import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import {
  currentMonitor,
  getCurrentWindow,
  primaryMonitor,
} from "@tauri-apps/api/window";
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  Bell,
  Check,
  CheckCheck,
  ChevronRight,
  Folder,
  LogOut,
  Minus,
  Plus,
  Repeat2,
  Settings as SettingsIcon,
  Square,
  UserCircle,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import mistyLogo from "../assets/misty-main-toolbar.png";
import { preloadDesktopFilesPage } from "../pages/Files";
import { selectedPathsForPane, useExplorerStore } from "../stores/useExplorerStore";
import type {
  ExplorerNotification,
  ExplorerNotificationType,
} from "../stores/useExplorerStore";
import { useAuth } from "../auth/AuthContext";
import { usePluginsStore } from "../stores/usePluginsStore";
import { useSetupStore } from "../stores/useSetupStore";
import { useUserStore } from "../stores/useUserStore";
import { useProvidersStore } from "../stores/useProvidersStore";
import SettingsWorkspace from "../pages/Settings/desktop";
import AccountWorkspace from "../pages/Account/desktop";
import {
  selectAppearancePreferences,
  selectCustomFontPreferences,
  selectNotificationPreferences,
  selectAssistantPreferences,
  selectSearchMaintenancePreferences,
  settingsBoolean,
  useSettingsStore,
} from "../stores/useSettingsStore";
import { useTransfersStore } from "../stores/useTransfersStore";
import {
  isRememberableAppRoute,
  useAppRouteMemoryStore,
} from "../stores/useAppRouteMemoryStore";
import { hasTauriInternals, safeTauriAssetUrl } from "../shared/tauri";
import { restoreBundledAssetOnError, runtimeAssetSource } from "../shared/assets/runtimeAsset";
import { useAppStore } from "../stores/useAppStore";
import { useAppThemeStore } from "../stores/useAppThemeStore";
import type { AppTab } from "../routing/types";
import type { TransferRecord, TransferStatus } from "../api/types";
import { isAndroidBuild, isNativeMobileBuild } from "../platform/buildTarget";
import {
  closeCloudFolderBotWindow,
  cloudFolderBotChatVisibilityEvent,
  cloudFolderBotContextRequestEvent,
  cloudFolderBotDismissEvent,
  cloudFolderBotOpenAssistantEvent,
  cloudFolderBotReturnToAppEvent,
  openCloudFolderBotChatWindow,
  openCloudFolderBotWindow,
  publishCloudFolderBotChatVisibility,
  setCloudFolderBotWindowVisible,
  type CloudFolderBotChatVisibility,
  publishCloudFolderBotContext,
} from "../bots/cloudFolderBot";
import { useMultiPanelStore } from "../shared/multipanel/useMultiPanelStore";
import { DeepSearchOverlay } from "../pages/Files/components/DeepSearchOverlay";
import { MediaSearchViewer } from "../pages/Files/components/MediaSearchViewer";
import { useSearchStore } from "../stores/useSearchStore";
import { useMediaSearchStore } from "../stores/useMediaSearchStore";
import { AgentJobWorker } from "../agents/AgentJobWorker";
import { SpacesRealtimeBridge } from "../spaces/SpacesRealtimeBridge";
import { useSpacesStore } from "../stores/useSpacesStore";
import type { SpaceInboxItem } from "../spaces/types";
import { AppWallpaperVideo } from "./AppWallpaperVideo";
import { useDocumentSurfaceVariables } from "./useDocumentSurfaceVariables";
import {
  advanceTransferCompletionTracker,
  emptyTransferCompletionTracker,
} from "./transferCompletionNotifications";

export type DesktopNavItem = {
  id: string;
  label: string;
  path: string;
  icon: typeof Folder;
  exact?: boolean;
  active?: (pathname: string) => boolean;
};
const DEFAULT_FONT_STACK = `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
type WindowBounds = {
  position: PhysicalPosition;
  size: PhysicalSize;
};

type WindowRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const desktopFrameClass =
  "relative isolate grid h-full min-h-0 grid-cols-[80px_minmax(0,1fr)] grid-rows-[var(--misty-window-titlebar-inset)_minmax(0,1fr)] overflow-hidden bg-[var(--misty-app-frame-bg,var(--misty-bg))]";
const tabletFrameClass =
  "relative isolate grid h-full min-h-0 grid-cols-[80px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden bg-[var(--misty-app-frame-bg,var(--misty-bg))] pt-[max(var(--misty-safe-top),28px)] pb-[max(var(--misty-safe-bottom),24px)]";

const desktopNavbarClass =
  "relative z-10 col-start-1 row-start-2 flex min-h-0 flex-col items-center overflow-hidden px-2 py-3";
const tabletNavbarClass =
  "relative z-10 col-start-1 row-start-1 flex min-h-0 flex-col items-center overflow-hidden px-2 py-3";

const desktopRouteShellClass =
  "relative z-10 col-start-2 row-start-2 min-h-0 overflow-hidden rounded-tl-xl border-l border-t border-[var(--misty-content-frame-border)] bg-transparent shadow-[0_12px_32px_rgba(0,0,0,0.18)]";
const tabletRouteShellClass =
  "relative z-10 col-start-2 row-start-1 min-h-0 overflow-hidden rounded-tl-xl border-l border-t border-[var(--misty-content-frame-border)] bg-transparent shadow-[0_12px_32px_rgba(0,0,0,0.18)]";

const navbarGroupClass = "flex w-full flex-col items-center gap-3";

const navbarBottomClass = "mt-auto flex w-full shrink-0 flex-col items-center gap-4";

const navLinkBaseClass =
  "grid h-[68px] w-16 shrink-0 grid-rows-[48px_18px] place-items-center text-[var(--misty-text-muted)] no-underline";

const navLinkActiveClass = "text-[var(--misty-text)]";

const navIconTileBaseClass =
  "relative grid h-[48px] w-[52px] place-items-center rounded-[12px] text-[var(--misty-text)] group-hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-2))]";

const navIconTileActiveClass = "bg-[var(--misty-neutral-selected-bg,var(--misty-surface-3))]";

const navItemLabelBaseClass =
  "block max-w-[64px] truncate text-center text-[11px] font-semibold leading-[1.25] tracking-[-0.01em] text-[var(--misty-text-subtle)] transition-colors group-hover:text-[var(--misty-text-muted)]";

const navItemLabelActiveClass = "text-[var(--misty-text)]";

const profileDockClass =
  "relative grid h-[48px] w-[48px] shrink-0 place-items-center rounded-full border border-[var(--misty-border-soft)] bg-[var(--misty-neutral-control-bg,var(--misty-surface-2))] p-0 text-base font-bold text-[var(--misty-text)] transition hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-3))]";

const profilePopoverClass =
  "fixed z-[2147482900] grid max-h-[calc(100vh-16px)] w-[286px] overflow-y-auto rounded-xl border border-[var(--misty-border-soft)] bg-[color-mix(in_srgb,var(--misty-surface)_96%,transparent)] p-2 text-[var(--misty-text)] shadow-[0_18px_52px_var(--misty-shadow)]";

const accountChooserPopoverClass =
  "fixed z-[2147482910] grid max-h-[calc(100vh-16px)] w-[320px] overflow-hidden rounded-xl border border-[var(--misty-border-soft)] bg-[color-mix(in_srgb,var(--misty-surface)_96%,transparent)] p-2 text-[var(--misty-text)] shadow-[0_18px_52px_var(--misty-shadow)]";

const profileMenuItemClass =
  "grid min-h-10 w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-sm text-[var(--misty-text-muted)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-2))] hover:text-[var(--misty-text)]";

const globalBannerBaseClass =
  "mt-3 max-w-[min(520px,calc(100vw-48px))] rounded-xl border border-[#2f3338] bg-[#07090b] px-3.5 py-2.5 text-sm text-[#f4f4f5] shadow-[0_14px_36px_rgba(0,0,0,0.52)]";

const globalNoticeLayerClass =
  "pointer-events-none fixed left-1/2 top-[calc(var(--misty-window-titlebar-inset)+28px)] z-[2147482800] grid -translate-x-1/2 justify-items-center";

const workStatusPopupClass =
  "pointer-events-none fixed left-1/2 top-[calc(var(--misty-window-titlebar-inset)+16px)] z-[2147482850] grid max-w-[min(360px,calc(100vw-96px))] -translate-x-1/2 grid-cols-[10px_minmax(0,1fr)] items-center gap-3 rounded-lg border border-[#2f3338] bg-[#07090b] px-3.5 py-2.5 text-sm text-[#f4f4f5] shadow-[0_18px_48px_rgba(0,0,0,0.52)]";

const workStatusPulseClass =
  "size-2.5 rounded-full bg-[var(--misty-success)] shadow-[0_0_18px_color-mix(in_srgb,var(--misty-success)_72%,transparent)]";
const workStatusToastDurationMs = 3500;

const activityPanelClass =
  "grid h-[min(460px,calc(100vh-24px))] w-[420px] min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-[#27272a] bg-[#0b0d0f] shadow-[0_24px_64px_rgba(0,0,0,0.42)]";

const activityPopoverClass = "fixed z-[2147482900] max-w-[calc(100vw-96px)]";

const activityButtonClass =
  "grid size-9 place-items-center rounded-lg border border-[#303640] bg-[#191a20] p-0 text-[#f1eee8] transition hover:bg-[#23252d] disabled:opacity-50";

const desktopTitlebarClass =
  "group/titlebar relative z-10 col-span-full row-start-1 h-full select-none border-b border-transparent bg-[var(--misty-app-nav-bg,var(--misty-bg))]";

const desktopTitlebarTitleClass =
  "pointer-events-none absolute inset-x-[112px] top-0 flex h-full min-w-0 items-center justify-center truncate text-[13px] font-semibold leading-none text-[var(--misty-text-muted)]";

const desktopTitlebarDoubleClickLayerClass = "absolute inset-0 cursor-default";

const windowsTitlebarControlsClass =
  "absolute right-0 top-0 z-[3] grid h-full grid-cols-3";

const windowsTitlebarControlButtonClass =
  "grid h-full w-[46px] place-items-center border-0 bg-transparent p-0 text-[var(--misty-text-muted)] transition hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-2))] hover:text-[var(--misty-text)]";

const windowsTitlebarCloseButtonClass =
  `${windowsTitlebarControlButtonClass} hover:bg-[#c42b1c] hover:text-white`;

type DesktopPlatform = "macos" | "windows" | "linux" | "browser" | "unknown";

const activityEntryBaseClass =
  "relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-md px-2.5 py-[9px]";

const frameOverlayBaseClass =
  "pointer-events-none fixed right-3 top-[calc(var(--misty-window-titlebar-inset)+10px)] z-[90] grid min-w-36 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-[3px] rounded-[7px] border bg-[color-mix(in_srgb,var(--misty-bg)_88%,transparent)] px-2.5 py-2 text-[11px] leading-[1.2] text-[var(--misty-text)] shadow-[0_12px_34px_var(--misty-shadow)]";

const settingsOverlayLayerClass =
  "fixed inset-0 z-[2147482600] grid place-items-center bg-[rgba(0,0,0,0.36)] p-8 backdrop-blur-[8px]";

const settingsOverlayPanelClass =
  "h-[min(760px,calc(100vh-64px))] w-[min(980px,calc(100vw-64px))] min-w-0 overflow-hidden rounded-2xl border border-[#242529] bg-[var(--misty-app-modal-bg,var(--misty-app-surface-bg,#07090b))] shadow-[0_28px_90px_rgba(0,0,0,0.62)] backdrop-blur-xl";

const frameOverlayLevelClass: Record<FramePacingState["level"], string> = {
  idle: "border-[color-mix(in_srgb,var(--misty-success)_45%,var(--misty-border-soft))]",
  light:
    "border-[color-mix(in_srgb,var(--misty-warning)_52%,var(--misty-border-soft))]",
  heavy:
    "border-[color-mix(in_srgb,var(--misty-danger)_58%,var(--misty-border-soft))]",
};

export function DesktopLayout(props: {
  getRouteId: (pathname: string) => AppTab;
  navItems: DesktopNavItem[];
}) {
  const usesNativeWindowChrome = !isNativeMobileBuild;
  const location = useLocation();
  const navigate = useNavigate();
  const { app, loadApp } = useAppStore(
    useShallow((state) => ({
      app: state.app,
      loadApp: state.loadApp,
    })),
  );
  const providerLoad = useProvidersStore((state) => state.load);
  const transferLoad = useTransfersStore((state) => state.load);
  const { settings, settingsLoad } = useSettingsStore(
    useShallow((state) => ({
      settings: state.settings,
      settingsLoad: state.load,
    })),
  );
  const localUnreadActivityCount = useExplorerStore(
    (state) =>
      state.notificationHistory.filter((notification) => !notification.read)
        .length,
  );
  const cloudUnreadActivityCount = useSpacesStore((state) =>
    [...state.inbox.unreads, ...state.inbox.mentions].filter((item) => !item.seen_at).length,
  );
  const unreadActivityCount = localUnreadActivityCount + cloudUnreadActivityCount;
  const activePaneId = useMultiPanelStore((state) => state.activePaneId);
  const activePanePath = useExplorerStore(
    (state) => state.panes[activePaneId]?.listing?.path ?? "",
  );
  const { customTokens, resolvedTheme, setSystemTheme, themeId, themeMode } = useAppThemeStore(
    useShallow((state) => ({
      customTokens: state.customTokens,
      resolvedTheme: state.resolvedTheme,
      setSystemTheme: state.setSystemTheme,
      themeId: state.themeId,
      themeMode: state.themeMode,
    })),
  );
  const appearancePreferences = useSettingsStore(
    useShallow((state) =>
      selectAppearancePreferences(state.settings?.document),
    ),
  );
  const appWallpaperSrc = useMemo(
    () => !isNativeMobileBuild && appearancePreferences.wallpaperPath
      ? safeTauriAssetUrl(appearancePreferences.wallpaperPath)
      : "",
    [appearancePreferences.wallpaperPath],
  );
  const mistyLogoSource = useMemo(
    () => runtimeAssetSource(app?.environment.assetsDir, "logos/misty.png", mistyLogo),
    [app?.environment.assetsDir],
  );
  const appWallpaperIsVideo = useMemo(
    () => isVideoWallpaperPath(appearancePreferences.wallpaperPath),
    [appearancePreferences.wallpaperPath],
  );
  const desktopFrameStyle = useMemo(() => {
    const panelOpacity = appearancePreferences.panelOpacity;
    const strongPanelOpacity = panelOpacity;
    const chromePanelOpacity = panelOpacity;
    const tabPanelOpacity = panelOpacity;
    const activeTabPanelOpacity = panelOpacity;
    const neutralControlOpacity = Math.min(0.14, 0.045 + panelOpacity * 0.095);
    const neutralHoverOpacity = Math.min(0.17, 0.06 + panelOpacity * 0.12);
    const neutralSelectedOpacity = Math.min(0.22, 0.075 + panelOpacity * 0.145);
    const neutralStrongOpacity = Math.min(0.28, 0.105 + panelOpacity * 0.175);
    const neutralBorderOpacity = Math.min(0.24, 0.08 + panelOpacity * 0.13);
    const appBodyBackground = appWallpaperSrc
      ? `rgba(24, 24, 24, ${panelOpacity})`
      : "var(--misty-page-bg)";
    const appNavBackground = appWallpaperSrc ? `rgba(16, 16, 16, ${panelOpacity})` : "var(--misty-nav-bg)";
    const appSurfaceBackground = appWallpaperSrc
      ? `rgba(17, 20, 24, ${panelOpacity})`
      : "var(--misty-surface)";
    const wallpaperSurfaceVars = appWallpaperSrc
      ? {
          "--misty-bg": `rgba(24, 24, 24, ${panelOpacity})`,
          "--misty-bg-soft": `rgba(9, 11, 14, ${panelOpacity})`,
          "--misty-surface": `rgba(17, 20, 24, ${panelOpacity})`,
          "--misty-surface-2": `rgba(244, 244, 245, ${neutralControlOpacity})`,
          "--misty-surface-3": `rgba(244, 244, 245, ${neutralSelectedOpacity})`,
          "--misty-surface-hover": `rgba(244, 244, 245, ${neutralHoverOpacity})`,
          "--misty-surface-selected": `rgba(244, 244, 245, ${neutralSelectedOpacity})`,
          "--misty-sidebar-selected": `rgba(244, 244, 245, ${neutralSelectedOpacity})`,
          "--misty-neutral-control-bg": `rgba(244, 244, 245, ${neutralControlOpacity})`,
          "--misty-neutral-hover-bg": `rgba(244, 244, 245, ${neutralHoverOpacity})`,
          "--misty-neutral-selected-bg": `rgba(244, 244, 245, ${neutralSelectedOpacity})`,
          "--misty-neutral-strong-bg": `rgba(244, 244, 245, ${neutralStrongOpacity})`,
          "--misty-neutral-border": `rgba(244, 244, 245, ${neutralBorderOpacity})`,
          "--misty-glass": `rgba(17, 20, 24, ${panelOpacity})`,
          "--misty-border": "transparent",
          "--misty-border-soft": "transparent",
          "--color-border": "transparent",
          "--color-border-subtle": "transparent",
          "--misty-skeleton-base": `rgba(244, 244, 245, ${neutralControlOpacity})`,
          "--misty-skeleton-highlight": `rgba(244, 244, 245, ${neutralSelectedOpacity})`,
          "--color-bg": `rgba(24, 24, 24, ${panelOpacity})`,
          "--color-surface": `rgba(17, 20, 24, ${panelOpacity})`,
          "--color-elevated": `rgba(244, 244, 245, ${neutralControlOpacity})`,
        }
      : {};
    return {
      "--misty-app-panel-opacity": String(panelOpacity),
      "--misty-app-panel-opacity-strong": String(strongPanelOpacity),
      "--misty-app-chrome-opacity": String(chromePanelOpacity),
      "--misty-app-tab-opacity": String(tabPanelOpacity),
      "--misty-app-tab-active-opacity": String(activeTabPanelOpacity),
      "--misty-border": "transparent",
      "--misty-border-soft": "transparent",
      "--misty-border-strong": `rgba(244, 244, 245, ${neutralBorderOpacity})`,
      "--color-border": "transparent",
      "--color-border-subtle": "transparent",
      "--misty-app-frame-bg": appWallpaperSrc ? "transparent" : "var(--misty-page-bg)",
      "--misty-app-page-bg": appBodyBackground,
      "--misty-app-shell-bg": appBodyBackground,
      "--misty-app-nav-bg": appNavBackground,
      "--misty-app-route-bg": appWallpaperSrc ? appBodyBackground : "transparent",
      "--misty-app-panel-bg": "transparent",
      "--misty-app-pane-bg": appSurfaceBackground,
      "--misty-app-surface-bg": appSurfaceBackground,
      "--misty-app-surface-soft-bg": appWallpaperSrc
        ? `rgba(17, 20, 24, ${panelOpacity})`
        : "var(--misty-surface-2)",
      "--misty-app-tab-bg": appBodyBackground,
      "--misty-app-tab-active-bg": appSurfaceBackground,
      "--misty-app-modal-bg": appWallpaperSrc
        ? `rgba(7, 9, 12, ${Math.min(0.78, panelOpacity + 0.08)})`
        : "var(--misty-surface)",
      ...wallpaperSurfaceVars,
    } as unknown as CSSProperties;
  }, [appWallpaperSrc, appearancePreferences.panelOpacity]);
  useDocumentSurfaceVariables(desktopFrameStyle);
  const desktopNavbarStyle = useMemo(() => ({
    backgroundColor: "var(--misty-app-nav-bg,var(--misty-bg))",
  }) satisfies CSSProperties, []);
  const customFontSignature = useSettingsStore((state) =>
    JSON.stringify(selectCustomFontPreferences(state.settings?.document)),
  );
  const notificationPreferences = useSettingsStore(
    useShallow((state) =>
      selectNotificationPreferences(state.settings?.document),
    ),
  );
  const searchMaintenancePreferences = useSettingsStore(
    useShallow((state) =>
      selectSearchMaintenancePreferences(state.settings?.document),
    ),
  );
  const cloudFolderBotEnabled = useSettingsStore(
    (state) => selectAssistantPreferences(state.settings?.document).enabled,
  );
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const framePacingOverlayEnabled = useSettingsStore((state) =>
    settingsBoolean(
      state.settings?.document ?? {},
      "advanced",
      "frame_pacing_overlay_enabled",
      false,
    ),
  );
  const rememberAppRoute = useAppRouteMemoryStore(
    (state) => state.rememberAppRoute,
  );
  const lastAppRoute = useAppRouteMemoryStore((state) => state.lastAppRoute);
  const lastSpacesRoute = useAppRouteMemoryStore((state) => state.lastSpacesRoute);
  const routeId = props.getRouteId(location.pathname);
  const appLoadStarted = useRef(false);
  const searchMaintenanceRunningRef = useRef(false);
  const loadedRoutes = useRef(new Set<AppTab>());
  const activityAnchorRef = useRef<HTMLButtonElement | null>(null);
  const profileAnchorRef = useRef<HTMLButtonElement | null>(null);
  const lastNonSettingsRouteRef = useRef(
    settingsFallbackRoute("/files", lastAppRoute),
  );
  const customZoomRestoreBoundsRef = useRef<WindowBounds | null>(null);
  const customZoomedRef = useRef(false);
  const customZoomAnimatingRef = useRef(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [desktopPlatform, setDesktopPlatform] =
    useState<DesktopPlatform>("unknown");
  const navItems = props.navItems;
  const openSettingsOverlay = useCallback(() => {
    setAccountSettingsOpen(false);
    setSettingsOpen(true);
    void settingsLoad();
  }, [settingsLoad]);
  const closeSettingsOverlay = useCallback(() => {
    setSettingsOpen(false);
  }, []);
  const openAccountSettingsOverlay = useCallback(() => {
    setSettingsOpen(false);
    setAccountSettingsOpen(true);
  }, []);
  const closeAccountSettingsOverlay = useCallback(() => {
    setAccountSettingsOpen(false);
  }, []);

  useEffect(() => {
    if (appLoadStarted.current) return;
    appLoadStarted.current = true;
    void preloadDesktopFilesPage()?.catch(() => undefined);
    void loadApp();
    void settingsLoad();
  }, [loadApp, settingsLoad]);

  useEffect(() => {
    if (!app || !hasTauriInternals()) return;
    // Loading the durable media queue at app startup resumes explicitly
    // approved work without requiring the user to revisit the Library page.
    void useMediaSearchStore.getState().load();
  }, [app]);

  useEffect(() => {
    if (!settings || !hasTauriInternals()) return;
    const intervalMs = searchMaintenancePreferences.discoveryIntervalMinutes * 60_000;
    let disposed = false;

    const maintainSearch = async () => {
      if (disposed || searchMaintenanceRunningRef.current) return;
      searchMaintenanceRunningRef.current = true;
      try {
        if (searchMaintenancePreferences.automaticFileDiscoveryEnabled) {
          const search = useSearchStore.getState();
          await search.initialize();
          const status = useSearchStore.getState().status;
          const stale = !status?.lastScanTimeMs || Date.now() - status.lastScanTimeMs >= intervalMs;
          if (!status?.scanInProgress && stale) {
            await useSearchStore.getState().startScan(app?.environment.homeDir || "");
          }
        }

      } finally {
        searchMaintenanceRunningRef.current = false;
      }
    };

    const initial = window.setTimeout(() => void maintainSearch(), 4_000);
    const timer = window.setInterval(() => void maintainSearch(), intervalMs);
    const resume = () => {
      if (document.visibilityState === "visible") void maintainSearch();
    };
    window.addEventListener("online", maintainSearch);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true;
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener("online", maintainSearch);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [
    app?.environment.homeDir,
    searchMaintenancePreferences.automaticFileDiscoveryEnabled,
    searchMaintenancePreferences.discoveryIntervalMinutes,
    settings,
  ]);

  useEffect(() => {
    const onGlobalSearchShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLocaleLowerCase() !== "k") return;
      event.preventDefault();
      event.stopPropagation();
      void useSearchStore.getState().openSearch(activePanePath || app?.environment.homeDir || "");
    };
    window.addEventListener("keydown", onGlobalSearchShortcut, true);
    return () => window.removeEventListener("keydown", onGlobalSearchShortcut, true);
  }, [activePanePath, app?.environment.homeDir]);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    if (cloudFolderBotEnabled) void openCloudFolderBotWindow(app?.environment.assetsDir);
    else void closeCloudFolderBotWindow();
  }, [app?.environment.assetsDir, cloudFolderBotEnabled]);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    let unlisten: UnlistenFn | null = null;
    void listen(cloudFolderBotDismissEvent, () => {
      void closeCloudFolderBotWindow();
    }).then((listener) => {
      unlisten = listener;
    });

    return () => {
      if (unlisten) void unlisten();
    };
  }, []);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    let unlisten: UnlistenFn | null = null;
    void listen(cloudFolderBotReturnToAppEvent, () => {
      const mainWindow = getCurrentWindow();
      void mainWindow.show().catch(() => undefined);
      void mainWindow.unminimize().catch(() => undefined);
      void mainWindow.setFocus().catch(() => undefined);
    }).then((listener) => {
      unlisten = listener;
    });

    return () => {
      if (unlisten) void unlisten();
    };
  }, []);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    let unlisten: UnlistenFn | null = null;
    void listen<CloudFolderBotChatVisibility>(cloudFolderBotChatVisibilityEvent, (event) => {
      void setCloudFolderBotWindowVisible(!event.payload.visible);
    }).then((listener) => {
      unlisten = listener;
    });

    return () => {
      if (unlisten) void unlisten();
    };
  }, []);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    let unlisten: UnlistenFn | null = null;
    void listen(cloudFolderBotOpenAssistantEvent, () => {
      void openCloudFolderBotChatWindow().catch(() => {
        void publishCloudFolderBotChatVisibility(false);
      });
    }).then((listener) => {
      unlisten = listener;
    });

    return () => {
      if (unlisten) void unlisten();
    };
  }, []);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    let unlisten: UnlistenFn | null = null;
    void listen(cloudFolderBotContextRequestEvent, () => {
      const activePaneId = useMultiPanelStore.getState().activePaneId;
      const pane = useExplorerStore.getState().panes[activePaneId];
      void publishCloudFolderBotContext({
        workingDirectory: pane?.listing?.path ?? "",
        selectedPaths: selectedPathsForPane(pane),
      });
    }).then((listener) => {
      unlisten = listener;
    });

    return () => {
      if (unlisten) void unlisten();
    };
  }, []);

  useEffect(() => {
    if (loadedRoutes.current.has(routeId)) return;
    loadedRoutes.current.add(routeId);
    if (
      routeId === "files" ||
      routeId === "providers" ||
      routeId === "diagnostics"
    ) {
      void providerLoad(routeId === "providers");
    }
    if (routeId === "transfers") void transferLoad("");
    if (routeId === "settings" && !settings) void settingsLoad();
  }, [providerLoad, routeId, settings, settingsLoad, transferLoad]);

  useEffect(() => {
    const route = `${location.pathname}${location.search}`;
    if (location.pathname === "/account") return;
    if (isRememberableAppRoute(route)) {
      rememberAppRoute(route);
    }
  }, [location.pathname, location.search, rememberAppRoute]);

  useEffect(() => {
    if (location.pathname.startsWith("/settings") || location.pathname === "/account") return;
    lastNonSettingsRouteRef.current = `${location.pathname}${location.search}`;
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!location.pathname.startsWith("/settings")) return;
    openSettingsOverlay();
    navigate(
      settingsFallbackRoute(lastNonSettingsRouteRef.current, lastAppRoute),
      { replace: true },
    );
  }, [lastAppRoute, location.pathname, navigate, openSettingsOverlay]);

  useEffect(() => {
    if (location.pathname !== "/account") return;
    openAccountSettingsOverlay();
    navigate(
      settingsFallbackRoute(lastNonSettingsRouteRef.current, lastAppRoute),
      { replace: true },
    );
  }, [lastAppRoute, location.pathname, navigate, openAccountSettingsOverlay]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.mistyTheme = themeId;
    root.dataset.themeMode = themeMode;
    root.dataset.compactMode = String(appearancePreferences.compactModeEnabled);
    root.dataset.fontSize = appearancePreferences.fontSize;
    root.dataset.reducedMotion = String(
      appearancePreferences.reducedMotionEnabled,
    );
    root.dataset.thumbnailPreviews = String(
      appearancePreferences.thumbnailPreviewsEnabled,
    );
    root.dataset.uiScale = appearancePreferences.uiScale;
    root.style.colorScheme = resolvedTheme;
  }, [appearancePreferences, resolvedTheme, themeId, themeMode]);

  useEffect(() => {
    const root = document.documentElement;
    const entries = Object.entries(desktopFrameStyle as Record<string, string>);
    root.dataset.mistyWallpaperActive = appWallpaperSrc ? "true" : "false";
    for (const [key, value] of entries) {
      root.style.setProperty(key, value);
    }

    return () => {
      for (const [key] of entries) {
        root.style.removeProperty(key);
      }
      delete root.dataset.mistyWallpaperActive;
    };
  }, [appWallpaperSrc, desktopFrameStyle]);

  useEffect(() => {
    const root = document.documentElement;
    const names: Record<string, string> = {
      background: "--misty-bg", surface: "--misty-surface", foreground: "--misty-text",
      muted: "--misty-text-muted", accent: "--misty-accent", selection: "--misty-selection",
      success: "--misty-success", warning: "--misty-warning", danger: "--misty-danger",
    };
    for (const [token, property] of Object.entries(names)) {
      const value = customTokens?.[token as keyof typeof customTokens];
      if (value) root.style.setProperty(property, value);
      else {
        const frameValue = (desktopFrameStyle as Record<string, string>)[property];
        if (frameValue) root.style.setProperty(property, frameValue);
        else root.style.removeProperty(property);
      }
    }
  }, [customTokens, desktopFrameStyle]);

  useEffect(() => {
    const badgeCount =
      notificationPreferences.badgeCountEnabled && unreadActivityCount > 0
        ? unreadActivityCount
        : undefined;
    try {
      if (!hasTauriInternals()) return;
      void getCurrentWindow()
        .setBadgeCount(badgeCount)
        .catch(() => {
          // Some platforms or browser test contexts do not support app badge counts.
        });
    } catch {
      // Some platforms or browser test contexts do not support app badge counts.
    }
  }, [notificationPreferences.badgeCountEnabled, unreadActivityCount]);

  useEffect(() => {
    const customFonts = parseCustomFontSignature(customFontSignature);
    const styleId = "misty-custom-fonts";
    const existing = document.getElementById(styleId);
    existing?.remove();

    if (customFonts.length === 0) {
      document.documentElement.style.setProperty(
        "--misty-font-family",
        DEFAULT_FONT_STACK,
      );
      return;
    }

    const rules = customFonts
      .map((font, index) => {
        const family = customFontFamilyName(index);
        return `@font-face{font-family:${cssString(family)};src:url(${cssUrl(safeTauriAssetUrl(font.path))});font-display:swap;}`;
      })
      .join("\n");
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = rules;
    document.head.appendChild(style);

    const customStack = customFonts
      .map((_, index) => cssString(customFontFamilyName(index)))
      .join(", ");
    document.documentElement.style.setProperty(
      "--misty-font-family",
      `${customStack}, ${DEFAULT_FONT_STACK}`,
    );

    return () => {
      style.remove();
    };
  }, [customFontSignature]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const syncSystemTheme = () =>
      setSystemTheme(query.matches ? "light" : "dark");
    syncSystemTheme();
    query.addEventListener("change", syncSystemTheme);
    return () => query.removeEventListener("change", syncSystemTheme);
  }, [setSystemTheme]);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    void getCurrentWebview()
      .setAutoResize(true)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!hasTauriInternals()) {
      setDesktopPlatform("browser");
      return;
    }

    try {
      setDesktopPlatform(osPlatform() as DesktopPlatform);
    } catch {
      setDesktopPlatform("unknown");
    }
  }, []);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    void invoke("enable_modern_window_style", {
      window: getCurrentWebviewWindow(),
      offsetX: -6,
      offsetY: -12,
    }).catch(() => undefined);
  }, []);

  const startTitlebarDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || event.detail > 1) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target?.closest("button,a,input,textarea,select,[role='button']")) {
        return;
      }

      event.preventDefault();
      if (!hasTauriInternals()) return;
      void getCurrentWindow()
        .startDragging()
        .catch(() => undefined);
    },
    [],
  );

  const animateWindowRect = useCallback(
    async (from: WindowRect, to: WindowRect, durationMs = 500) => {
      if (!hasTauriInternals()) {
        return;
      }
      if (customZoomAnimatingRef.current) {
        return;
      }

      customZoomAnimatingRef.current = true;
      const window = getCurrentWindow();
      if (desktopPlatform === "windows") {
        try {
          await window.setPosition(new PhysicalPosition(to.x, to.y));
          await window.setSize(new PhysicalSize(to.width, to.height));
        } finally {
          customZoomAnimatingRef.current = false;
        }
        return;
      }

      const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

      return new Promise<void>((resolve) => {
        const start = performance.now();

        const step = (now: number) => {
          const progress = Math.min(1, (now - start) / durationMs);
          const eased = easeOutCubic(progress);
          const x = Math.round(from.x + (to.x - from.x) * eased);
          const y = Math.round(from.y + (to.y - from.y) * eased);
          const width = Math.round(
            from.width + (to.width - from.width) * eased,
          );
          const height = Math.round(
            from.height + (to.height - from.height) * eased,
          );

          void window.setPosition(new PhysicalPosition(x, y));
          void window.setSize(new PhysicalSize(width, height));

          if (progress < 1) {
            requestAnimationFrame(step);
            return;
          }

          customZoomAnimatingRef.current = false;
          resolve();
        };

        requestAnimationFrame(step);
      });
    },
    [desktopPlatform],
  );

  const togglePseudoMaximize = useCallback(async () => {
    if (!hasTauriInternals()) return;
    const window = getCurrentWindow();
    if (await window.isFullscreen()) {
      return;
    }

    const [position, size, monitor] = await Promise.all([
      window.outerPosition(),
      window.outerSize(),
      currentMonitor().then((current) => current ?? primaryMonitor()),
    ]);

    const currentRect = {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    };

    if (!customZoomedRef.current) {
      if (!monitor) {
        return;
      }

      customZoomRestoreBoundsRef.current = { position, size };
      await animateWindowRect(currentRect, {
        x: monitor.workArea.position.x,
        y: monitor.workArea.position.y,
        width: monitor.workArea.size.width,
        height: monitor.workArea.size.height,
      });
      customZoomedRef.current = true;
      return;
    }

    const restoreBounds = customZoomRestoreBoundsRef.current;
    if (!restoreBounds) {
      customZoomedRef.current = false;
      return;
    }

    await animateWindowRect(currentRect, {
      x: restoreBounds.position.x,
      y: restoreBounds.position.y,
      width: restoreBounds.size.width,
      height: restoreBounds.size.height,
    });
    customZoomedRef.current = false;
  }, [animateWindowRect]);

  const expandTitlebarWindow = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      event.stopPropagation();
      event.preventDefault();
      void togglePseudoMaximize().catch(() => undefined);
    },
    [togglePseudoMaximize],
  );

  const minimizeTitlebarWindow = useCallback(() => {
    if (!hasTauriInternals()) return;
    void getCurrentWindow()
      .minimize()
      .catch(() => undefined);
  }, []);

  const closeTitlebarWindow = useCallback(() => {
    if (!hasTauriInternals()) return;
    void getCurrentWindow()
      .close()
      .catch(() => undefined);
  }, []);

  const shouldShowWindowsTitlebarControls =
    usesNativeWindowChrome && (desktopPlatform === "windows" || desktopPlatform === "linux");
  const frameClass = usesNativeWindowChrome ? desktopFrameClass : tabletFrameClass;
  const navbarClass = usesNativeWindowChrome ? desktopNavbarClass : tabletNavbarClass;
  const routeShellClass = usesNativeWindowChrome ? desktopRouteShellClass : tabletRouteShellClass;

  return (
    <main
      className={frameClass}
      data-wallpaper-active={appWallpaperSrc ? "true" : "false"}
      style={desktopFrameStyle}
    >
      {appWallpaperSrc ? (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          {appWallpaperIsVideo ? (
            <AppWallpaperVideo src={appWallpaperSrc} />
          ) : (
            <img
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
              src={appWallpaperSrc}
            />
          )}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,6,7,0.04),rgba(5,6,7,0.16))]" />
        </div>
      ) : null}
      {usesNativeWindowChrome ? <header
        className={desktopTitlebarClass}
        data-tauri-drag-region
        onPointerDown={startTitlebarDrag}
      >
        <div
          className={desktopTitlebarDoubleClickLayerClass}
          onDoubleClick={expandTitlebarWindow}
        />
        <span className={desktopTitlebarTitleClass}>Misty</span>
        {shouldShowWindowsTitlebarControls ? (
          <div className={windowsTitlebarControlsClass}>
            <button
              type="button"
              className={windowsTitlebarControlButtonClass}
              aria-label="Minimize window"
              title="Minimize"
              onClick={minimizeTitlebarWindow}
            >
              <Minus size={15} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className={windowsTitlebarControlButtonClass}
              aria-label="Maximize or restore window"
              title="Maximize"
              onClick={() => void togglePseudoMaximize().catch(() => undefined)}
            >
              <Square size={13} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className={windowsTitlebarCloseButtonClass}
              aria-label="Close window"
              title="Close"
              onClick={closeTitlebarWindow}
            >
              <X size={16} strokeWidth={1.8} />
            </button>
          </div>
        ) : null}
      </header> : null}

      <nav
        className={navbarClass}
        style={desktopNavbarStyle}
        aria-label="Primary"
        onPointerDown={usesNativeWindowChrome ? startTitlebarDrag : undefined}
      >
        <div
          className="mb-3 grid h-[62px] w-[62px] place-items-center"
          title={app?.migrationStage ?? "Misty"}
        >
          <img
            className="h-[58px] w-[58px] object-contain"
            src={mistyLogoSource}
            onError={(event) => restoreBundledAssetOnError(event, mistyLogo)}
            alt="Misty"
          />
        </div>
        <div className={navbarGroupClass}>
          <NavGroup currentPath={location.pathname} items={navItems} routeOverrides={{ spaces: lastSpacesRoute }} />
        </div>
        <div className={navbarBottomClass}>
          <ActivityNavButton
            ref={activityAnchorRef}
            open={activityOpen}
            badge={
              notificationPreferences.badgeCountEnabled
                ? unreadActivityCount
                : 0
            }
            onClick={() => {
              setActivityOpen((open) => !open);
            }}
          />
          <SettingsNavButton
            open={settingsOpen || location.pathname.startsWith("/settings")}
            onClick={openSettingsOverlay}
          />
          <ProfileNavButton
            ref={profileAnchorRef}
            open={profileOpen}
            onClick={() => setProfileOpen((open) => !open)}
          />
        </div>
      </nav>

      <section className={`${routeShellClass} route-shell`}>
        <AppNoticePublisher />
        <RouteNotice routeId={routeId} />

        <Outlet />
      </section>

      <WorkStatusPopup />
      <TransferCompletionNotifier />
      <FramePacingOverlay enabled={framePacingOverlayEnabled} />
      <ActivityPopover
        anchorRef={activityAnchorRef}
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
      />
      <ProfilePopover
        anchorRef={profileAnchorRef}
        currentPath={location.pathname}
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onOpenAccountSettings={openAccountSettingsOverlay}
        onOpenSettings={openSettingsOverlay}
      />
      <AccountSettingsOverlay
        open={accountSettingsOpen}
        style={desktopFrameStyle}
        onClose={closeAccountSettingsOverlay}
      />
      <SettingsOverlay
        open={settingsOpen}
        style={desktopFrameStyle}
        onClose={closeSettingsOverlay}
      />
      <DeepSearchOverlay
        activePaneId={activePaneId}
        currentPath={activePanePath || app?.environment.homeDir || ""}
      />
      <MediaSearchViewer />
      <AgentJobWorker />
      <SpacesRealtimeBridge />
    </main>
  );
}

function parseCustomFontSignature(
  signature: string,
): Array<{ label: string; path: string }> {
  try {
    const value = JSON.parse(signature) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is { label: string; path: string } =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as Record<string, unknown>).label === "string" &&
        typeof (entry as Record<string, unknown>).path === "string",
    );
  } catch {
    return [];
  }
}

function customFontFamilyName(index: number): string {
  return `Misty Custom Font ${index + 1}`;
}

function cssString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function cssUrl(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const videoWallpaperExtensions = new Set(["m4v", "mov", "mp4", "ogv", "webm"]);

function isVideoWallpaperPath(path: string): boolean {
  const cleanPath = path.split(/[?#]/, 1)[0] ?? "";
  const extensionStart = cleanPath.lastIndexOf(".");
  if (extensionStart < 0) return false;
  return videoWallpaperExtensions.has(cleanPath.slice(extensionStart + 1).toLowerCase());
}

const RouteNotice = memo(function RouteNotice(props: { routeId: AppTab }) {
  const appError = useAppStore((state) => state.error);
  const appMessage = useAppStore((state) => state.message);
  const providerError = useProvidersStore((state) => state.error);
  const providerMessage = useProvidersStore((state) => state.message);
  const transferError = useTransfersStore((state) => state.error);
  const transferMessage = useTransfersStore((state) => state.message);
  const settingsError = useSettingsStore((state) => state.error);
  const settingsMessage = useSettingsStore((state) => state.message);
  const notificationPreferences = useSettingsStore(
    useShallow((state) =>
      selectNotificationPreferences(state.settings?.document),
    ),
  );
  const notice = noticeForRoute(props.routeId, {
    app: { error: appError, message: appMessage },
    providers: { error: providerError, message: providerMessage },
    transfers: { error: transferError, message: transferMessage },
    settings: { error: settingsError, message: settingsMessage },
  });
  const showMessage =
    notificationPreferences.inAppNotificationsEnabled &&
    !notificationPreferences.quietHoursEnabled;

  if (!notice.error && !(showMessage && notice.message)) return null;

  return (
    <div className={globalNoticeLayerClass}>
      {notice.error ? (
        <div
          className={`${globalBannerBaseClass} border-[color-mix(in_srgb,var(--misty-danger)_42%,#2f3338)] text-[var(--misty-danger)]`}
        >
          {notice.error}
        </div>
      ) : null}
      {showMessage && notice.message ? (
        <div
          className={`${globalBannerBaseClass} border-[color-mix(in_srgb,var(--misty-success)_38%,#2f3338)] text-[var(--misty-success)]`}
        >
          {notice.message}
        </div>
      ) : null}
    </div>
  );
});

type AppNoticeSource = "app" | "providers" | "transfers" | "settings";
type AppNoticeKind = "error" | "message";
type AppNoticeEntry = readonly [AppNoticeSource, AppNoticeKind, string | null];

const AppNoticePublisher = memo(function AppNoticePublisher() {
  const appError = useAppStore((state) => state.error);
  const appMessage = useAppStore((state) => state.message);
  const providerError = useProvidersStore((state) => state.error);
  const providerMessage = useProvidersStore((state) => state.message);
  const transferError = useTransfersStore((state) => state.error);
  const transferMessage = useTransfersStore((state) => state.message);
  const settingsError = useSettingsStore((state) => state.error);
  const settingsMessage = useSettingsStore((state) => state.message);
  const lastPublished = useRef<Record<string, string>>({});

  useEffect(() => {
    const entries = [
      ["app", "error", appError],
      ["app", "message", appMessage],
      ["providers", "error", providerError],
      ["providers", "message", providerMessage],
      ["transfers", "error", transferError],
      ["transfers", "message", transferMessage],
      ["settings", "error", settingsError],
      ["settings", "message", settingsMessage],
    ] satisfies AppNoticeEntry[];
    const pushNotification = useExplorerStore.getState().pushNotification;

    for (const [source, kind, value] of entries) {
      const key = `${source}:${kind}`;
      const message = value?.trim() ?? "";
      if (!message) {
        lastPublished.current[key] = "";
        continue;
      }

      const signature = `${kind}:${message}`;
      if (lastPublished.current[key] === signature) continue;
      lastPublished.current[key] = signature;
      pushNotification(
        `${appNoticeSourceLabel(source)}: ${message}`,
        appNoticeType(kind),
        kind === "error" ? 5500 : 3500,
        false,
      );
    }
  }, [
    appError,
    appMessage,
    providerError,
    providerMessage,
    transferError,
    transferMessage,
    settingsError,
    settingsMessage,
  ]);

  return null;
});

const activeWorkStatuses = new Set<TransferRecord["status"]>([
  "queued",
  "pending",
  "in_progress",
]);
const emptyTransferRows: TransferRecord[] = [];

const WorkStatusPopup = memo(function WorkStatusPopup() {
  const rows = useTransfersStore(
    (state) => state.transfers?.rows ?? emptyTransferRows,
  );
  const loadTransfers = useTransfersStore((state) => state.load);
  const setupInstalling = useSetupStore(
    (state) => state.installState === "installing" || state.busy,
  );
  const pluginInstalling = usePluginsStore((state) =>
    Boolean(state.actionPluginId),
  );
  const [visibleSummary, setVisibleSummary] = useState<{ title: string; detail: string } | null>(null);

  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      if (!disposed) void loadTransfers(undefined, { silent: true });
    };
    refresh();
    const interval = window.setInterval(refresh, 2000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [loadTransfers]);

  const summary = workStatusSummary(rows, setupInstalling || pluginInstalling);
  const summaryTitle = summary?.title ?? "";
  const summaryDetail = summary?.detail ?? "";

  useEffect(() => {
    if (!summaryTitle) {
      setVisibleSummary(null);
      return;
    }
    setVisibleSummary({ title: summaryTitle, detail: summaryDetail });
    const timeout = window.setTimeout(() => {
      setVisibleSummary(null);
    }, workStatusToastDurationMs);
    return () => window.clearTimeout(timeout);
  }, [summaryTitle, summaryDetail]);

  if (!visibleSummary) return null;

  return (
    <aside className={workStatusPopupClass} role="status" aria-live="polite">
      <span className={workStatusPulseClass} />
      <span className="min-w-0">
        <strong className="block truncate text-[13px] font-semibold leading-tight">
          {visibleSummary.title}
        </strong>
        <span className="block truncate text-xs leading-tight text-[var(--misty-text-muted)]">
          {visibleSummary.detail}
        </span>
      </span>
    </aside>
  );
});

const transferNotificationStatuses = new Set<TransferStatus>([
  "completed",
  "failed",
  "interrupted",
]);

const TransferCompletionNotifier = memo(function TransferCompletionNotifier() {
  const transferPage = useTransfersStore((state) => state.transfers);
  const trackerRef = useRef(emptyTransferCompletionTracker());

  useEffect(() => {
    // A null page means the durable transfer history has not loaded yet. Do
    // not treat that temporary empty state as the completion baseline.
    if (!transferPage) return;
    const advanced = advanceTransferCompletionTracker(
      trackerRef.current,
      transferPage.rows,
      transferNotificationStatuses,
    );
    trackerRef.current = advanced.tracker;
    const pushNotification = useExplorerStore.getState().pushNotification;
    for (const row of advanced.changed) {
      if (row.status === "completed") {
        pushNotification(`Transfer finished: ${transferNotificationTitle(row)}`, "success", 4200);
      } else {
        pushNotification(`Transfer needs attention: ${transferNotificationTitle(row)}`, "error", 5600);
      }
    }
  }, [transferPage]);

  return null;
});

function NavGroup(props: {
  items: DesktopNavItem[];
  badges?: Partial<Record<string, number>>;
  currentPath: string;
  routeOverrides?: Partial<Record<string, string>>;
}) {
  return (
    <>
      {props.items.map((item) => {
        const Icon = item.icon;
        const selected = isNavItemActive(item, props.currentPath);
        return (
          <NavLink
            aria-current={selected ? "page" : undefined}
            aria-label={item.label}
            className={`group ${navLinkBaseClass} ${selected ? navLinkActiveClass : ""}`}
            end={item.exact}
            key={item.id}
            title={item.label}
            to={props.routeOverrides?.[item.id] ?? item.path}
          >
            <span
              className={`${navIconTileBaseClass} ${selected ? navIconTileActiveClass : ""}`}
            >
              <Icon size={24} strokeWidth={1.85} />
              {props.badges?.[item.id] ? (
                <span className="absolute right-px top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#d83e3e] px-[5px] text-[10px] font-bold leading-none text-white shadow-[0_0_0_2px_var(--misty-bg)]">
                  {formatBadgeCount(props.badges[item.id] ?? 0)}
                </span>
              ) : null}
            </span>
            <span
              className={`${navItemLabelBaseClass} ${selected ? navItemLabelActiveClass : ""}`}
            >
              {item.label}
            </span>
          </NavLink>
        );
      })}
    </>
  );
}

function isNavItemActive(item: DesktopNavItem, pathname: string): boolean {
  if (item.active) return item.active(pathname);
  if (item.exact) return pathname === item.path;
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}

const ActivityNavButton = memo(
  forwardRef<
    HTMLButtonElement,
    {
      badge: number;
      open: boolean;
      onClick: () => void;
    }
  >(function ActivityNavButton(props, ref) {
    return (
      <button
        ref={ref}
        className={`group ${navLinkBaseClass} ${props.open ? navLinkActiveClass : ""}`}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={props.open}
        aria-label="Activity"
        title="Activity"
        onClick={props.onClick}
      >
        <span
          className={`${navIconTileBaseClass} ${props.open ? navIconTileActiveClass : ""}`}
        >
          <Bell size={29} strokeWidth={1.85} />
          {props.badge ? (
            <span className="absolute right-px top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#d83e3e] px-[5px] text-[10px] font-bold leading-none text-white shadow-[0_0_0_2px_var(--misty-bg)]">
              {formatBadgeCount(props.badge)}
            </span>
          ) : null}
        </span>
        <span
          className={`${navItemLabelBaseClass} ${props.open ? navItemLabelActiveClass : ""}`}
        >
          Activity
        </span>
      </button>
    );
  }),
);

function SettingsNavButton(props: { open: boolean; onClick: () => void }) {
  return (
    <button
      className={`group ${navLinkBaseClass} ${props.open ? navLinkActiveClass : ""}`}
      type="button"
      aria-haspopup="dialog"
      aria-expanded={props.open}
      aria-label="Settings"
      title="Settings"
      onClick={props.onClick}
    >
      <span
        className={`${navIconTileBaseClass} ${props.open ? navIconTileActiveClass : ""}`}
      >
        <SettingsIcon size={29} strokeWidth={1.85} />
      </span>
      <span
        className={`${navItemLabelBaseClass} ${props.open ? navItemLabelActiveClass : ""}`}
      >
        Settings
      </span>
    </button>
  );
}

const ProfileNavButton = memo(
  forwardRef<
    HTMLButtonElement,
    {
      open: boolean;
      onClick: () => void;
    }
  >(function ProfileNavButton(props, ref) {
    const currentUser = useSetupStore(
      (state) => state.status?.current_user ?? null,
    );
    const { user } = useAuth();
    const me = useUserStore(
      useShallow((state) => ({
        email: state.me?.email,
        name: state.me?.name,
      })),
    );
    const account = currentUser ?? user;
    const email = me.email ?? account?.email ?? "";
    const displayName = me.name ?? account?.name ?? emailName(email) ?? "Misty";
    const initials = initialsForProfile(displayName, email);

    return (
      <button
        ref={ref}
        className={profileDockClass}
        type="button"
        aria-label="Profile"
        aria-haspopup="menu"
        aria-expanded={props.open}
        title={account ? `${displayName} (${email})` : "Profile"}
        onClick={props.onClick}
      >
        {account ? initials : <UserCircle size={24} strokeWidth={1.75} />}
      </button>
    );
  }),
);

function ProfilePopover(props: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  currentPath: string;
  open: boolean;
  onClose: () => void;
  onOpenAccountSettings: () => void;
  onOpenSettings: () => void;
}) {
  const navigate = useNavigate();
  const currentUser = useSetupStore(
    (state) => state.status?.current_user ?? null,
  );
  const { user, accounts, switchAccount, logout } = useAuth();
  const me = useUserStore(
    useShallow((state) => ({
      email: state.me?.email,
      name: state.me?.name,
    })),
  );
  const setActiveSettingsSection = useSettingsStore(
    (state) => state.setActiveSection,
  );
  const menuRef = useRef<HTMLDivElement | null>(null);
  const accountChooserRef = useRef<HTMLDivElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const [accountChooserStyle, setAccountChooserStyle] = useState<CSSProperties>({});
  const [accountChooserOpen, setAccountChooserOpen] = useState(false);
  const [switchingAccountId, setSwitchingAccountId] = useState("");
  const [switchError, setSwitchError] = useState("");
  const account = currentUser ?? user;
  const email = me.email ?? account?.email ?? "";
  const displayName = me.name ?? account?.name ?? emailName(email) ?? "Misty";
  const initials = initialsForProfile(displayName, email);

  const updatePosition = useCallback(() => {
    const anchor = props.anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = 286;
    const estimatedHeight = 236;
    const left = Math.min(
      Math.max(8, rect.right + 10),
      window.innerWidth - width - 8,
    );
    const top = Math.min(
      Math.max(8, rect.bottom - estimatedHeight),
      window.innerHeight - estimatedHeight - 8,
    );
    setMenuStyle((current) =>
      current.left === left && current.top === top && current.width === width
        ? current
        : { left, top, width },
    );
    const chooserWidth = 320;
    const chooserHeight = Math.min(420, window.innerHeight - 16);
    const chooserLeft = left + width + 8;
    const chooserTop = Math.min(
      Math.max(8, rect.bottom - chooserHeight),
      window.innerHeight - chooserHeight - 8,
    );
    setAccountChooserStyle((current) => (
      current.left === chooserLeft
      && current.top === chooserTop
      && current.width === chooserWidth
        ? current
        : { left: chooserLeft, top: chooserTop, width: chooserWidth }
    ));
  }, [props.anchorRef]);

  useEffect(() => {
    if (!props.open) return;
    updatePosition();
    const closeOnPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        props.anchorRef.current?.contains(target) ||
        menuRef.current?.contains(target) ||
        accountChooserRef.current?.contains(target)
      )
        return;
      props.onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (accountChooserOpen) {
        setAccountChooserOpen(false);
        return;
      }
      props.onClose();
    };
    window.addEventListener("pointerdown", closeOnPointerDown, true);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown, true);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updatePosition);
    };
  }, [accountChooserOpen, props.anchorRef, props.onClose, props.open, updatePosition]);

  useEffect(() => {
    if (props.open) return;
    setAccountChooserOpen(false);
    setSwitchingAccountId("");
    setSwitchError("");
  }, [props.open]);

  if (!props.open) return null;

  const openAccountSettings = () => {
    props.onClose();
    props.onOpenAccountSettings();
  };

  const switchAccounts = () => {
    setSwitchError("");
    setAccountChooserOpen(true);
  };

  const chooseAccount = async (accountId: string) => {
    if (accountId === user?.id || switchingAccountId) return;
    setSwitchError("");
    setSwitchingAccountId(accountId);
    try {
      await switchAccount(accountId);
      props.onClose();
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : "That account could not be activated.");
    } finally {
      setSwitchingAccountId("");
    }
  };

  const addAccount = () => {
    props.onClose();
    navigate("/signin", { state: { from: props.currentPath, addingAccount: true } });
  };

  const signOut = () => {
    props.onClose();
    logout();
  };

  return createPortal(
    <>
      <div
        ref={menuRef}
        className={profilePopoverClass}
        style={menuStyle}
        role="menu"
        aria-label="Profile"
      >
        <div className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-3 border-b border-[var(--misty-border-soft)] px-2 pb-3 pt-1">
          <span className="relative grid h-10 w-10 place-items-center rounded-full bg-[var(--misty-neutral-selected-bg,var(--misty-surface-3))] text-sm font-bold">
            {account ? initials : <UserCircle size={24} strokeWidth={1.75} />}
          </span>
          <span className="min-w-0">
            <strong className="block truncate text-sm">{displayName}</strong>
            <small className="block truncate text-xs text-[var(--misty-text-muted)]">
              {email || "Not signed in"}
            </small>
          </span>
        </div>
        <div className="grid gap-1 py-2">
          <span className="px-2.5 py-1 text-[10px] font-bold capitalize text-[var(--misty-text-subtle)]">
            User/Profile Settings
          </span>
          <button className={profileMenuItemClass} type="button" role="menuitem" onClick={openAccountSettings}>
            <UserCircle size={17} />
            <span>Account settings</span>
          </button>
          <button
            className={`${profileMenuItemClass} ${accountChooserOpen ? "bg-[var(--misty-neutral-selected-bg,var(--misty-surface-3))] text-[var(--misty-text)]" : ""}`}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={accountChooserOpen}
            onClick={() => accountChooserOpen ? setAccountChooserOpen(false) : switchAccounts()}
          >
            <Repeat2 size={17} />
            <span>Switch accounts</span>
            <ChevronRight size={14} className={accountChooserOpen ? "text-[var(--misty-text)]" : "text-[var(--misty-text-subtle)]"} />
          </button>
          <button className={profileMenuItemClass} type="button" role="menuitem" onClick={signOut}>
            <LogOut size={17} />
            <span>{account ? "Sign out" : "Clear session"}</span>
          </button>
          <div className="my-1 h-px bg-[var(--misty-border-soft)]" />
          <span className="px-2.5 py-1 text-[10px] font-bold capitalize text-[var(--misty-text-subtle)]">
            Misty App Settings
          </span>
          <button
            className={profileMenuItemClass}
            type="button"
            role="menuitem"
            onClick={() => {
              setActiveSettingsSection("general");
              props.onClose();
              props.onOpenSettings();
            }}
          >
            <SettingsIcon size={17} />
            <span>Open app settings</span>
          </button>
        </div>
      </div>
      {accountChooserOpen ? (
        <div
          ref={accountChooserRef}
          className={accountChooserPopoverClass}
          style={accountChooserStyle}
          role="menu"
          aria-label="Switch accounts"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--misty-border-soft)] px-2 pb-2 pt-1">
            <div><strong className="block text-sm">Switch accounts</strong><small className="text-[11px] text-[var(--misty-text-subtle)]">Your saved Misty sessions</small></div>
            <button className="grid size-8 place-items-center rounded-lg border-0 bg-transparent text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-2)] hover:text-[var(--misty-text)]" type="button" aria-label="Close account chooser" onClick={() => setAccountChooserOpen(false)}><X size={16}/></button>
          </div>
          <div className="grid max-h-[268px] gap-1 overflow-auto py-2">
            {accounts.map((saved) => {
              const active = saved.id === user?.id;
              const savedInitials = initialsForProfile(saved.name, saved.email);
              return (
                <button className={`${profileMenuItemClass} min-h-[54px] grid-cols-[36px_minmax(0,1fr)_20px]`} type="button" role="menuitem" key={saved.id} disabled={Boolean(switchingAccountId)} onClick={() => void chooseAccount(saved.id)}>
                  <span className="grid size-9 place-items-center rounded-full bg-[var(--misty-neutral-selected-bg,var(--misty-surface-3))] text-xs font-bold text-[var(--misty-text)]">{savedInitials}</span>
                  <span className="min-w-0"><strong className="block truncate text-xs text-[var(--misty-text)]">{saved.name}</strong><small className="block truncate text-[10px] text-[var(--misty-text-subtle)]">{switchingAccountId === saved.id ? "Switching…" : saved.email}</small></span>
                  {active ? <Check size={15} className="text-emerald-300" aria-label="Active account"/> : null}
                </button>
              );
            })}
            {accounts.length === 0 ? <p className="m-0 px-2 py-3 text-xs text-[var(--misty-text-subtle)]">No saved accounts are available yet.</p> : null}
          </div>
          {switchError ? <p className="m-0 mb-2 rounded-lg border border-red-400/20 bg-red-950/20 px-2.5 py-2 text-[11px] leading-relaxed text-red-200" role="alert">{switchError}</p> : null}
          <button className={profileMenuItemClass} type="button" role="menuitem" disabled={Boolean(switchingAccountId)} onClick={addAccount}><Plus size={17}/><span>Add another account</span></button>
          <p className="m-0 px-2.5 pb-1 pt-2 text-[10px] leading-relaxed text-[var(--misty-text-subtle)]">Accounts remain signed in securely on this device. Only one account is active in the app at a time.</p>
        </div>
      ) : null}
    </>,
    document.body,
  );
}

function initialsForProfile(name: string, email: string): string {
  const initials = name
    .split(" ")
    .map((word) => word.trim()[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return initials || email[0]?.toUpperCase() || "M";
}

function emailName(email: string): string | null {
  const name = email.split("@")[0]?.trim();
  return name || null;
}

function ActivityPopover(props: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  open: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: 84, top: 12 });
  const [tab, setTab] = useState<"unreads" | "mentions">("unreads");
  const navigate = useNavigate();
  const { history, clearHistory, markRead } = useExplorerStore(
    useShallow((state) => ({
      history: state.notificationHistory,
      clearHistory: state.clearNotificationHistory,
      markRead: state.markNotificationsRead,
    })),
  );
  const { inbox, loadInbox, markInboxSeen, clearInbox } = useSpacesStore(useShallow((state) => ({
    inbox: state.inbox,
    loadInbox: state.loadInbox,
    markInboxSeen: state.markInboxSeen,
    clearInbox: state.clearInbox,
  })));
  const localEntries = tab === "unreads" ? [...history].reverse() : [];
  const cloudEntries = inbox[tab];
  const hasEntries = localEntries.length + cloudEntries.length > 0;
  useEffect(() => {
    if (!props.open) return;
    markRead();
    void markInboxSeen().then(loadInbox);
  }, [loadInbox, markInboxSeen, markRead, props.open]);
  useEffect(() => {
    if (!props.open) return;
    const syncPosition = () => {
      const rect = props.anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const panelWidth = 420;
      const panelHeight = Math.min(460, window.innerHeight - 24);
      const left = Math.min(
        window.innerWidth - panelWidth - 12,
        rect.right + 10,
      );
      const top = Math.min(
        Math.max(12, rect.top + rect.height / 2 - panelHeight / 2),
        window.innerHeight - panelHeight - 12,
      );
      setPosition((current) =>
        current.left === left && current.top === top ? current : { left, top },
      );
    };
    syncPosition();
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);
    return () => {
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }, [props.anchorRef, props.open]);
  useEffect(() => {
    if (!props.open) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      if (target && props.anchorRef.current?.contains(target)) return;
      props.onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [props.anchorRef, props.onClose, props.open]);
  if (!props.open) return null;

  return createPortal(
    <div
      ref={panelRef}
      className={activityPopoverClass}
      style={{ left: position.left, top: position.top }}
    >
      <section
        className={activityPanelClass}
        role="dialog"
        aria-label="Activity"
      >
        <header className="flex items-center justify-between gap-3.5 border-b border-[#333944] p-4">
          <h2 className="m-0 text-lg font-semibold leading-tight text-[#f1eee8]">
            Activity
          </h2>
          <button
            className={activityButtonClass}
            type="button"
            onClick={() => {
              if (tab === "unreads") clearHistory();
              void clearInbox(tab);
            }}
            disabled={!hasEntries}
            aria-label="Clear all activity"
            title="Clear all activity"
          >
            <CheckCheck size={19} strokeWidth={2} />
          </button>
        </header>
        <div className="grid grid-cols-2 border-b border-[#333944] px-4">
          {(["unreads", "mentions"] as const).map((item) => (
            <button
              className={`relative h-10 border-0 bg-transparent text-xs font-semibold capitalize ${tab === item ? "text-[#f1eee8] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-violet-400" : "text-[#9e9890]"}`}
              type="button"
              key={item}
              onClick={() => setTab(item)}
            >
              {item}
              {inbox[item].length > 0 ? <span className="ml-1.5 rounded-full bg-[#252832] px-1.5 py-0.5 text-[9px]">{formatBadgeCount(inbox[item].length)}</span> : null}
            </button>
          ))}
        </div>
        {hasEntries ? (
          <div className="min-h-0 overflow-auto px-4 py-3">
            {cloudEntries.length > 0 ? <p className="mb-1 mt-0 px-2 text-[9px] font-semibold capitalize text-[#77736d]">Spaces</p> : null}
            {cloudEntries.map((entry) => (
              <CloudActivityEntry key={entry.id} entry={entry} onOpen={() => {
                navigate(`/spaces/${encodeURIComponent(entry.space_id)}/chat${entry.message_id ? `?message=${encodeURIComponent(entry.message_id)}` : ""}`);
                props.onClose();
              }} />
            ))}
            {localEntries.length > 0 && cloudEntries.length > 0 ? <p className="mb-1 mt-4 px-2 text-[9px] font-semibold capitalize text-[#77736d]">This Device</p> : null}
            {localEntries.map((entry) => (
              <ActivityEntry key={entry.id} entry={entry} />
            ))}
          </div>
        ) : (
          <div className="grid content-center justify-items-center gap-2 text-center text-[#9e9890]">
            <h3 className="m-0 text-lg font-semibold leading-tight text-[#f1eee8]">
              {tab === "mentions" ? "No mentions" : "You’re all caught up"}
            </h3>
            <p className="mt-1.5 text-[#9e9890]">
              {tab === "mentions" ? "Direct mentions, Agent replies, and approvals will appear here." : "New Space messages and local file activity will appear here."}
            </p>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}

function CloudActivityEntry(props: { entry: SpaceInboxItem; onOpen: () => void }) {
  const fallback = props.entry.kind === "mention"
    ? `You were mentioned in ${props.entry.space_name}`
    : props.entry.kind === "agent"
      ? `Agent activity in ${props.entry.space_name}`
      : props.entry.kind === "workflow"
        ? `Workflow activity in ${props.entry.space_name}`
        : `New message in ${props.entry.space_name}`;
  const sender = typeof props.entry.payload.sender_name === "string" ? props.entry.payload.sender_name : "";
  const preview = typeof props.entry.payload.preview === "string" ? props.entry.payload.preview : "";
  const label = preview ? `${sender ? `${sender}: ` : ""}${preview}` : fallback;
  return (
    <button className={`${activityEntryBaseClass} grid w-full border-0 bg-transparent text-left [&+&]:mt-1`} type="button" onClick={props.onOpen}>
      <span className="m-0 min-w-0 [overflow-wrap:anywhere] leading-[1.35] text-[#f1eee8]"><small className="mb-0.5 block text-[10px] font-semibold text-violet-300">{props.entry.space_name}</small>{label}</span>
      <time className="whitespace-nowrap pt-px text-xs text-[#9e9890]">{formatActivityTime(new Date(props.entry.created_at).getTime())}</time>
    </button>
  );
}

function ActivityEntry(props: { entry: ExplorerNotification }) {
  return (
    <article
      className={`${activityEntryBaseClass} ${props.entry.read ? "" : "bg-[rgba(241,238,232,0.035)]"} [&+&]:mt-1`}
    >
      <p className="m-0 min-w-0 [overflow-wrap:anywhere] leading-[1.35] text-[#f1eee8]">
        {props.entry.message}
      </p>
      <time className="whitespace-nowrap pt-px text-xs text-[#9e9890]">
        {formatActivityTime(props.entry.createdAtMs)}
      </time>
    </article>
  );
}

function SettingsOverlay(props: { open: boolean; style: CSSProperties; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onClose, props.open]);

  if (!props.open) return null;

  return createPortal(
    <div
      className={`app-pages-root ${settingsOverlayLayerClass}`}
      style={props.style}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        ref={panelRef}
        className={settingsOverlayPanelClass}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <SettingsWorkspace presentation="overlay" onClose={props.onClose} />
      </div>
    </div>,
    document.body,
  );
}

function AccountSettingsOverlay(props: { open: boolean; style: CSSProperties; onClose: () => void }) {
  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onClose, props.open]);

  if (!props.open) return null;

  return createPortal(
    <div
      className={`app-pages-root ${settingsOverlayLayerClass}`}
      style={props.style}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        className={settingsOverlayPanelClass}
        role="dialog"
        aria-modal="true"
        aria-label="Account settings"
      >
        <AccountWorkspace presentation="overlay" onClose={props.onClose} />
      </div>
    </div>,
    document.body,
  );
}

function formatActivityTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

type FramePacingState = {
  fps: number;
  frameMs: number;
  slowFramePercent: number;
  level: "idle" | "light" | "heavy";
};

function FramePacingOverlay(props: { enabled: boolean }) {
  const [state, setState] = useState<FramePacingState>({
    fps: 0,
    frameMs: 0,
    slowFramePercent: 0,
    level: "idle",
  });

  useEffect(() => {
    if (!props.enabled) return;

    let animationFrame = 0;
    let lastFrameAt = performance.now();
    let sampleStartedAt = lastFrameAt;
    let frameCount = 0;
    let slowFrameCount = 0;
    let totalFrameMs = 0;

    const tick = (now: number) => {
      const frameMs = now - lastFrameAt;
      lastFrameAt = now;

      if (frameCount > 0) {
        totalFrameMs += frameMs;
        if (frameMs > 34) slowFrameCount += 1;
      }
      frameCount += 1;

      const elapsedMs = now - sampleStartedAt;
      if (elapsedMs >= 600) {
        const measuredFrames = Math.max(1, frameCount - 1);
        const fps = Math.round((frameCount * 1000) / elapsedMs);
        const averageFrameMs = totalFrameMs / measuredFrames;
        const slowFramePercent = Math.round(
          (slowFrameCount / measuredFrames) * 100,
        );
        const level =
          fps < 45 || slowFramePercent > 25
            ? "heavy"
            : fps < 56 || slowFramePercent > 8
              ? "light"
              : "idle";

        setState((previous) => {
          if (
            previous.fps === fps &&
            Math.abs(previous.frameMs - averageFrameMs) < 0.1 &&
            previous.slowFramePercent === slowFramePercent &&
            previous.level === level
          ) {
            return previous;
          }
          return { fps, frameMs: averageFrameMs, slowFramePercent, level };
        });

        sampleStartedAt = now;
        frameCount = 0;
        slowFrameCount = 0;
        totalFrameMs = 0;
      }

      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [props.enabled]);

  if (!props.enabled) return null;

  const label =
    state.level === "idle"
      ? "Idle"
      : state.level === "light"
        ? "Light"
        : "Heavy";

  return (
    <aside
      className={`${frameOverlayBaseClass} ${frameOverlayLevelClass[state.level]}`}
      aria-label="Frame pacing overlay"
    >
      <strong className="col-span-full text-xs font-extrabold">{label}</strong>
      <span className="whitespace-nowrap text-[var(--misty-text-muted)] tabular-nums">
        {state.fps > 0 ? state.fps : "--"} FPS
      </span>
      <span className="whitespace-nowrap text-[var(--misty-text-muted)] tabular-nums">
        {state.frameMs > 0 ? state.frameMs.toFixed(1) : "--"} ms
      </span>
      <span className="whitespace-nowrap text-[var(--misty-text-muted)] tabular-nums">
        {state.slowFramePercent}% slow
      </span>
    </aside>
  );
}

function settingsFallbackRoute(
  previousRoute: string,
  rememberedRoute: string,
): string {
  const candidates = [previousRoute, rememberedRoute, "/files"];
  return (
    candidates.find((route) => {
      if (!route || route.startsWith("/settings") || route === "/account") return false;
      return isRememberableAppRoute(route);
    }) ?? "/files"
  );
}

function noticeForRoute(
  route: AppTab,
  notices: Record<
    "app" | "providers" | "transfers" | "settings",
    { error: string | null; message: string | null }
  >,
) {
  const scoped =
    route === "providers" || route === "transfers" || route === "settings"
      ? notices[route]
      : notices.app;
  return {
    error: scoped.error ?? notices.app.error,
    message: scoped.message ?? notices.app.message,
  };
}

function appNoticeSourceLabel(source: AppNoticeSource): string {
  switch (source) {
    case "providers":
      return "Remotes";
    case "transfers":
      return "Transfers";
    case "settings":
      return "Settings";
    case "app":
      return "Misty";
  }
}

function appNoticeType(kind: AppNoticeKind): ExplorerNotificationType {
  return kind === "error" ? "error" : "success";
}

function transferNotificationTitle(row: TransferRecord): string {
  const title = row.queueTitle.trim() || row.fileName.trim();
  if (title) return title;
  return `${row.transferType} #${row.id}`;
}

function workStatusSummary(
  rows: TransferRecord[],
  installing: boolean,
): { title: string; detail: string } | null {
  const active = rows.filter((row) => activeWorkStatuses.has(row.status));
  const downloads = active.filter(
    (row) => row.transferType === "download",
  ).length;
  const uploads = active.filter((row) => row.transferType === "upload").length;

  if (downloads > 0 && uploads > 0) {
    return {
      title: "Transferring...",
      detail: `${downloads} ${downloads === 1 ? "download" : "downloads"}, ${uploads} ${uploads === 1 ? "upload" : "uploads"}`,
    };
  }
  if (downloads > 0) {
    return {
      title: "Downloading...",
      detail: `${downloads} active ${downloads === 1 ? "download" : "downloads"}`,
    };
  }
  if (uploads > 0) {
    return {
      title: "Uploading...",
      detail: `${uploads} active ${uploads === 1 ? "upload" : "uploads"}`,
    };
  }
  if (installing) {
    return {
      title: "Installing...",
      detail: "Setting up Misty components",
    };
  }
  return null;
}
