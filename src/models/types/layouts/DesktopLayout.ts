import { Button } from "@/ui";
import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { createPortal } from "react-dom";
import { enableModernWindowStyle } from "@/stores/backend";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import { currentMonitor, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
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
import { preloadDesktopFilesPage } from "@/features/explorer";
import { selectedPathsForPane, useExplorerStore } from "@/stores/explorer";
import type { ExplorerNotification, ExplorerNotificationType } from "@/stores/explorer";
import { useAuth } from "@/features/auth/AuthContext";
import { useSetupStore } from "@/stores/app";
import { useUserStore } from "@/stores/account/useUserStore";
import { useProvidersStore } from "@/stores/providers";
import SettingsWorkspace from "@/pages/Settings/desktop";
import AccountWorkspace from "@/pages/Account/desktop";
import {
  selectAppearancePreferences,
  selectNotificationPreferences,
  selectAssistantPreferences,
  selectSearchMaintenancePreferences,
  settingsBoolean,
  useSettingsStore,
} from "@/stores/app";
import { useTransfersStore } from "@/stores/transfers";
import { isRememberableAppRoute, useAppRouteMemoryStore } from "@/stores/app";
import { hasTauriInternals, safeTauriAssetUrl } from "@/platform/tauri";
import {
  hideRuntimeAssetOnError,
  revealRuntimeAssetOnLoad,
  runtimeAssetSource,
} from "@/platform/runtimeAsset";
import { useAppStore } from "@/stores/app";
import { useAppThemeStore } from "@/stores/app";
import type { AppTab } from "@/models/types/routing/types";
import type { TransferStatus } from "@/models/types/services/misty-api";
import type { TransferRecord } from "@/models/interfaces/services/misty-api";
import { isAndroidBuild, isNativeMobileBuild } from "@/platform/buildTarget";
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
  publishCloudFolderBotContext,
} from "@/features/bots/cloudFolderBot";
import type { CloudFolderBotChatVisibility } from "@/models/interfaces/features/bots/cloudFolderBot";
import { useMultiPanelStore } from "@/features/workspace";
import { DeepSearchOverlay } from "@/features/explorer/components/DeepSearchOverlay";
import { MediaSearchViewer } from "@/features/explorer/components/MediaSearchViewer";
import { useSearchStore } from "@/stores/explorer";
import { useMediaSearchStore } from "@/stores/media/useMediaSearchStore";
import { AgentJobWorker } from "@/features/agents/AgentJobWorker";
import { SpacesRealtimeBridge } from "@/features/spaces/SpacesRealtimeBridge";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import type { SpaceInboxItem } from "@/models/interfaces/features/spaces/types";
import { AppWallpaperVideo } from "@/layouts/AppWallpaperVideo";
import { useDocumentSurfaceVariables } from "@/layouts/useDocumentSurfaceVariables";
import {
  advanceTransferCompletionTracker,
  emptyTransferCompletionTracker,
} from "@/layouts/transferCompletionNotifications";

export type DesktopNavItem = {
  id: string;
  label: string;
  path: string;
  icon: typeof Folder;
  exact?: boolean;
  active?: (pathname: string) => boolean;
};

export type WindowBounds = {
  position: PhysicalPosition;
  size: PhysicalSize;
};

export type WindowRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DesktopPlatform = "macos" | "windows" | "linux" | "browser" | "unknown";

export type AppNoticeSource = "app" | "providers" | "transfers" | "settings";

export type AppNoticeKind = "error" | "message";

export type AppNoticeEntry = readonly [AppNoticeSource, AppNoticeKind, string | null];

export type FramePacingState = {
  fps: number;
  frameMs: number;
  slowFramePercent: number;
  level: "idle" | "light" | "heavy";
};
