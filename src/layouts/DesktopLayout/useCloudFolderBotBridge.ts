import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { selectedPathsForPane, useExplorerStore } from "@/stores/explorer";
import { useMultiPanelStore } from "@/features/workspace";
import { hasTauriInternals } from "@/platform/tauri";
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
  publishCloudFolderBotContext,
  setCloudFolderBotWindowVisible,
} from "@/features/bots/cloudFolderBot";
import type { CloudFolderBotChatVisibility } from "@/models/interfaces/features/bots/cloudFolderBot";

export function useCloudFolderBotBridge(params: {
  cloudFolderBotEnabled: boolean;
  assetsDir: string | undefined;
}) {
  const { cloudFolderBotEnabled, assetsDir } = params;

  useEffect(() => {
    if (!hasTauriInternals()) return;
    if (cloudFolderBotEnabled) void openCloudFolderBotWindow(assetsDir);
    else void closeCloudFolderBotWindow();
  }, [assetsDir, cloudFolderBotEnabled]);

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
}
