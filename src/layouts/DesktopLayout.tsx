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
  Folder,
  LogOut,
  Minus,
  Repeat2,
  Settings as SettingsIcon,
  Square,
  UserCircle,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import mistyLogo from "../../assets/logos/misty.png";
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
import {
  selectAppearancePreferences,
  selectCustomFontPreferences,
  selectGeneralPreferences,
  selectNotificationPreferences,
  selectAssistantPreferences,
  settingsBoolean,
  useSettingsStore,
} from "../stores/useSettingsStore";
import { useTransfersStore } from "../stores/useTransfersStore";
import {
  isRememberableAppRoute,
  useAppRouteMemoryStore,
} from "../stores/useAppRouteMemoryStore";
import { hasTauriInternals, safeTauriAssetUrl } from "../shared/tauri";
import { useAppStore } from "../stores/useAppStore";
import { useAppThemeStore } from "../stores/useAppThemeStore";
import type { AppTab } from "../routing/types";
import type { TransferRecord, TransferStatus } from "../api/types";
import { isAndroidBuild } from "../platform/buildTarget";
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
  "relative isolate grid h-full min-h-0 grid-cols-[72px_minmax(0,1fr)] grid-rows-[28px_minmax(0,1fr)] overflow-hidden bg-[var(--misty-app-frame-bg,var(--misty-bg))]";
const androidDesktopFrameClass =
  "relative isolate grid h-full min-h-0 grid-cols-[72px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden bg-[var(--misty-app-frame-bg,var(--misty-bg))] pt-[max(var(--misty-safe-top),28px)] pb-[max(var(--misty-safe-bottom),24px)]";

const desktopNavbarClass =
  "relative z-10 col-start-1 row-start-2 flex min-h-0 flex-col items-center overflow-hidden border-r border-transparent px-1 pb-2.5 pt-2";
const androidDesktopNavbarClass =
  "relative z-10 col-start-1 row-start-1 flex min-h-0 flex-col items-center overflow-hidden border-r border-transparent px-1 pb-2.5 pt-2";

const desktopRouteShellClass =
  "relative z-10 col-start-2 row-start-2 min-h-0 overflow-hidden bg-transparent";
const androidDesktopRouteShellClass =
  "relative z-10 col-start-2 row-start-1 min-h-0 overflow-hidden bg-transparent";

const navbarGroupClass = "flex w-full flex-col items-center gap-3";

const navbarBottomClass = `${navbarGroupClass} mt-auto`;

const navLinkBaseClass =
  "grid h-[58px] w-16 place-items-center text-[var(--misty-text-muted)] no-underline";

const navLinkActiveClass = "text-[var(--misty-text)]";

const navIconTileBaseClass =
  "relative grid h-[52px] w-[52px] place-items-center rounded-[12px] text-[var(--misty-text)] group-hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-2))]";

const navIconTileActiveClass = "bg-[var(--misty-neutral-selected-bg,var(--misty-surface-3))]";

const profileDockClass =
  "relative grid h-[48px] w-[48px] place-items-center rounded-full border border-[var(--misty-border-soft)] bg-[var(--misty-neutral-control-bg,var(--misty-surface-2))] p-0 text-base font-bold text-[var(--misty-text)] transition hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-3))]";

const profilePopoverClass =
  "fixed z-[2147482900] grid w-[286px] overflow-hidden rounded-xl border border-[var(--misty-border-soft)] bg-[color-mix(in_srgb,var(--misty-surface)_96%,transparent)] p-2 text-[var(--misty-text)] shadow-[0_18px_52px_var(--misty-shadow)]";

const profileMenuItemClass =
  "grid min-h-10 w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-sm text-[var(--misty-text-muted)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-2))] hover:text-[var(--misty-text)]";

const globalBannerBaseClass =
  "mt-3 max-w-[min(520px,calc(100vw-48px))] rounded-xl border border-[#2f3338] bg-[#07090b] px-3.5 py-2.5 text-sm text-[#f4f4f5] shadow-[0_14px_36px_rgba(0,0,0,0.52)]";

const globalNoticeLayerClass =
  "pointer-events-none fixed left-1/2 top-14 z-[2147482800] grid -translate-x-1/2 justify-items-center";

const workStatusPopupClass =
  "pointer-events-none fixed left-1/2 top-4 z-[2147482850] grid max-w-[min(360px,calc(100vw-96px))] -translate-x-1/2 grid-cols-[10px_minmax(0,1fr)] items-center gap-3 rounded-lg border border-[#2f3338] bg-[#07090b] px-3.5 py-2.5 text-sm text-[#f4f4f5] shadow-[0_18px_48px_rgba(0,0,0,0.52)]";

const workStatusPulseClass =
  "size-2.5 rounded-full bg-[var(--misty-success)] shadow-[0_0_18px_color-mix(in_srgb,var(--misty-success)_72%,transparent)]";
const workStatusToastDurationMs = 3500;

const activityPanelClass =
  "grid h-[min(560px,calc(100vh-24px))] w-[420px] min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-[#27272a] bg-[#0b0d0f] shadow-[0_24px_64px_rgba(0,0,0,0.42)]";

const activityPopoverClass = "fixed z-[2147482900] max-w-[calc(100vw-96px)]";

const activityButtonClass =
  "min-h-7 rounded-md border border-[#303640] bg-[#121820] px-2.5 py-1 text-[13px] text-[#d8dde6] disabled:opacity-50";

const desktopTitlebarClass =
  "group/titlebar relative z-10 col-span-full row-start-1 h-7 select-none border-b border-transparent bg-[var(--misty-app-nav-bg,var(--misty-bg))]";

const desktopTitlebarTitleClass =
  "pointer-events-none absolute inset-x-[112px] top-0 flex h-full min-w-0 items-center justify-center truncate text-[13px] font-semibold leading-none text-[var(--misty-text-muted)]";

const desktopTitlebarDoubleClickLayerClass = "absolute inset-0 cursor-default";

const windowsTitlebarControlsClass =
  "absolute right-0 top-0 z-[3] grid h-full grid-cols-3";

const windowsTitlebarControlButtonClass =
  "grid h-7 w-[46px] place-items-center border-0 bg-transparent p-0 text-[var(--misty-text-muted)] transition hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-2))] hover:text-[var(--misty-text)]";

const windowsTitlebarCloseButtonClass =
  `${windowsTitlebarControlButtonClass} hover:bg-[#c42b1c] hover:text-white`;

type DesktopPlatform = "macos" | "windows" | "linux" | "browser" | "unknown";

const activityEntryBaseClass =
  "relative grid grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-2 rounded-md px-1.5 py-[7px]";

const frameOverlayBaseClass =
  "pointer-events-none fixed right-3 top-2.5 z-[90] grid min-w-36 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-[3px] rounded-[7px] border bg-[color-mix(in_srgb,var(--misty-bg)_88%,transparent)] px-2.5 py-2 text-[11px] leading-[1.2] text-[var(--misty-text)] shadow-[0_12px_34px_var(--misty-shadow)]";

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
  const usesNativeWindowChrome = !isAndroidBuild;
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
  const unreadActivityCount = useExplorerStore(
    (state) =>
      state.notificationHistory.filter((notification) => !notification.read)
        .length,
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
    () => !isAndroidBuild && appearancePreferences.wallpaperPath
      ? safeTauriAssetUrl(appearancePreferences.wallpaperPath)
      : "",
    [appearancePreferences.wallpaperPath],
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
      ? `rgba(5, 6, 7, ${panelOpacity})`
      : "var(--misty-bg)";
    const appSurfaceBackground = appWallpaperSrc
      ? `rgba(17, 20, 24, ${panelOpacity})`
      : "var(--misty-surface)";
    const wallpaperSurfaceVars = appWallpaperSrc
      ? {
          "--misty-bg": `rgba(5, 6, 7, ${panelOpacity})`,
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
          "--color-bg": `rgba(11, 13, 16, ${panelOpacity})`,
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
      "--misty-app-frame-bg": appWallpaperSrc ? "transparent" : "var(--misty-bg)",
      "--misty-app-page-bg": appBodyBackground,
      "--misty-app-shell-bg": appBodyBackground,
      "--misty-app-nav-bg": appBodyBackground,
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
  const desktopNavbarStyle = useMemo(
    () => ({
      backgroundColor: "var(--misty-app-nav-bg,var(--misty-bg))",
    }) satisfies CSSProperties,
    [],
  );
  const customFontSignature = useSettingsStore((state) =>
    JSON.stringify(selectCustomFontPreferences(state.settings?.document)),
  );
  const notificationPreferences = useSettingsStore(
    useShallow((state) =>
      selectNotificationPreferences(state.settings?.document),
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
  const routeId = props.getRouteId(location.pathname);
  const appLoadStarted = useRef(false);
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
  const [desktopPlatform, setDesktopPlatform] =
    useState<DesktopPlatform>("unknown");
  const navItems = props.navItems;
  const openSettingsOverlay = useCallback(() => {
    setSettingsOpen(true);
    void settingsLoad();
  }, [settingsLoad]);
  const closeSettingsOverlay = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  useEffect(() => {
    if (appLoadStarted.current) return;
    appLoadStarted.current = true;
    void loadApp();
    void settingsLoad();
  }, [loadApp, settingsLoad]);

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
    if (isRememberableAppRoute(route)) {
      rememberAppRoute(route);
    }
  }, [location.pathname, location.search, rememberAppRoute]);

  useEffect(() => {
    if (location.pathname.startsWith("/settings")) return;
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
  const frameClass = usesNativeWindowChrome ? desktopFrameClass : androidDesktopFrameClass;
  const navbarClass = usesNativeWindowChrome ? desktopNavbarClass : androidDesktopNavbarClass;
  const routeShellClass = usesNativeWindowChrome ? desktopRouteShellClass : androidDesktopRouteShellClass;

  return (
    <main
      className={frameClass}
      data-wallpaper-active={appWallpaperSrc ? "true" : "false"}
      style={desktopFrameStyle}
    >
      {appWallpaperSrc ? (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          {appWallpaperIsVideo ? (
            <video
              className="h-full w-full object-cover"
              src={appWallpaperSrc}
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
            />
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
            src={mistyLogo}
            alt="Misty"
          />
        </div>
        <div className={navbarGroupClass}>
          <NavGroup currentPath={location.pathname} items={navItems} />
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
        onOpenSettings={openSettingsOverlay}
      />
      <SettingsOverlay
        open={settingsOpen}
        style={desktopFrameStyle}
        onClose={closeSettingsOverlay}
      />
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
  const rows = useTransfersStore(
    (state) => state.transfers?.rows ?? emptyTransferRows,
  );
  const readyRef = useRef(false);
  const statusesRef = useRef<Record<number, TransferStatus>>({});

  useEffect(() => {
    const nextStatuses = Object.fromEntries(
      rows.map((row) => [row.id, row.status]),
    ) as Record<number, TransferStatus>;

    if (!readyRef.current) {
      statusesRef.current = nextStatuses;
      readyRef.current = true;
      return;
    }

    const previousStatuses = statusesRef.current;
    const pushNotification = useExplorerStore.getState().pushNotification;
    for (const row of rows) {
      if (!transferNotificationStatuses.has(row.status)) continue;
      if (previousStatuses[row.id] === row.status) continue;
      if (row.status === "completed") {
        pushNotification(`Transfer finished: ${transferNotificationTitle(row)}`, "success", 4200);
      } else {
        pushNotification(`Transfer needs attention: ${transferNotificationTitle(row)}`, "error", 5600);
      }
    }

    statusesRef.current = nextStatuses;
  }, [rows]);

  return null;
});

function NavGroup(props: {
  items: DesktopNavItem[];
  badges?: Partial<Record<string, number>>;
  currentPath: string;
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
            to={item.path}
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
  onOpenSettings: () => void;
}) {
  const navigate = useNavigate();
  const currentUser = useSetupStore(
    (state) => state.status?.current_user ?? null,
  );
  const { user, logout } = useAuth();
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
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const account = currentUser ?? user;
  const email = me.email ?? account?.email ?? "";
  const displayName = me.name ?? account?.name ?? emailName(email) ?? "Misty";
  const initials = initialsForProfile(displayName, email);

  const updatePosition = useCallback(() => {
    const anchor = props.anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = 286;
    const left = Math.min(
      Math.max(8, rect.right + 10),
      window.innerWidth - width - 8,
    );
    const top = Math.min(
      Math.max(8, rect.bottom - 220),
      window.innerHeight - 236,
    );
    setMenuStyle((current) =>
      current.left === left && current.top === top && current.width === width
        ? current
        : { left, top, width },
    );
  }, [props.anchorRef]);

  useEffect(() => {
    if (!props.open) return;
    updatePosition();
    const closeOnPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        props.anchorRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      )
        return;
      props.onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("pointerdown", closeOnPointerDown, true);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown, true);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updatePosition);
    };
  }, [props.anchorRef, props.onClose, props.open, updatePosition]);

  if (!props.open) return null;

  const openAccountSettings = () => {
    props.onClose();
    navigate("/account", { state: { from: props.currentPath } });
  };

  const switchAccounts = () => {
    props.onClose();
    logout();
    navigate("/signin", { state: { from: "/account" } });
  };

  const signOut = () => {
    props.onClose();
    logout();
  };

  return createPortal(
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
        <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-normal text-[var(--misty-text-subtle)]">
          User/Profile Settings
        </span>
        <button
          className={profileMenuItemClass}
          type="button"
          role="menuitem"
          onClick={openAccountSettings}
        >
          <UserCircle size={17} />
          <span>Account settings</span>
        </button>
        <button
          className={profileMenuItemClass}
          type="button"
          role="menuitem"
          onClick={switchAccounts}
        >
          <Repeat2 size={17} />
          <span>Switch accounts</span>
        </button>
        <button
          className={profileMenuItemClass}
          type="button"
          role="menuitem"
          onClick={signOut}
        >
          <LogOut size={17} />
          <span>{account ? "Sign out" : "Clear session"}</span>
        </button>
        <div className="my-1 h-px bg-[var(--misty-border-soft)]" />
        <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-normal text-[var(--misty-text-subtle)]">
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
    </div>,
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
  const { history, clearHistory, markRead } = useExplorerStore(
    useShallow((state) => ({
      history: state.notificationHistory,
      clearHistory: state.clearNotificationHistory,
      markRead: state.markNotificationsRead,
    })),
  );
  const confirmDestructiveActions = useSettingsStore(
    (state) =>
      selectGeneralPreferences(state.settings?.document)
        .confirmDestructiveActions,
  );
  const entries = [...history].reverse();
  const hasEntries = entries.length > 0;
  useEffect(() => {
    if (!props.open) return;
    const syncPosition = () => {
      const rect = props.anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const panelWidth = 420;
      const panelHeight = Math.min(560, window.innerHeight - 24);
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
  const clearActivityHistory = () => {
    if (
      confirmDestructiveActions &&
      !window.confirm("Clear all Activity notifications on this device?")
    ) {
      return;
    }
    clearHistory();
  };

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
        <header className="flex items-start justify-between gap-3.5 border-b border-[#333944] p-4">
          <div>
            <h2 className="m-0 text-lg font-semibold leading-tight text-[#f1eee8]">
              Activity
            </h2>
            <p className="mt-1.5 text-[var(--misty-text-muted)]">
              File work and local action history.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className={activityButtonClass}
              type="button"
              onClick={markRead}
              disabled={!hasEntries}
            >
              Mark Read
            </button>
            <button
              className={activityButtonClass}
              type="button"
              onClick={clearActivityHistory}
              disabled={!hasEntries}
            >
              Clear
            </button>
          </div>
        </header>
        {hasEntries ? (
          <div className="min-h-0 overflow-auto px-4 py-3">
            {entries.map((entry) => (
              <ActivityEntry key={entry.id} entry={entry} />
            ))}
          </div>
        ) : (
          <div className="grid content-center justify-items-center gap-2 text-center text-[#9e9890]">
            <h3 className="m-0 text-lg font-semibold leading-tight text-[#f1eee8]">
              No notifications
            </h3>
            <p className="mt-1.5 text-[#9e9890]">
              File actions and workspace events will appear here.
            </p>
          </div>
        )}
        <footer className="border-t border-[#252b33] px-4 py-[9px] text-xs text-[#9e9890]">
          Notifications are local to this device.
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function ActivityEntry(props: { entry: ExplorerNotification }) {
  const statusColor =
    props.entry.type === "success"
      ? "bg-[#6bb878]"
      : props.entry.type === "error"
        ? "bg-[#d15757]"
        : "bg-[#999faa]";
  return (
    <article
      className={`${activityEntryBaseClass} ${props.entry.read ? "" : "bg-[rgba(241,238,232,0.035)]"} [&+&]:mt-1`}
    >
      <span
        className={`mx-auto mt-[7px] h-[7px] w-[7px] rounded-full ${statusColor}`}
      />
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
      if (!route || route.startsWith("/settings")) return false;
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
