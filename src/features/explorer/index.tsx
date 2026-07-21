import { lazy, Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { ExplorerLoadingShell } from "./components/ExplorerLoadingShell";
import { useExplorerStore } from "@/stores/explorer";
import { useAppStore } from "@/stores/app";
import {
  openCloudFolderBotChatWindow,
  openCloudFolderBotWindow,
} from "@/features/bots/cloudFolderBot";

const loadDesktopFilesPage = () => import("./desktop");
const DesktopFilesPage = lazy(loadDesktopFilesPage);

export function preloadDesktopFilesPage(): Promise<unknown> {
  return loadDesktopFilesPage();
}

export default function FilesPage() {
  const [searchParams] = useSearchParams();
  const assetsDir = useAppStore((state) => state.app?.environment.assetsDir);
  const openedLegacyMika = useRef(false);

  useEffect(() => {
    if (searchParams.get("mika") !== "open" || openedLegacyMika.current) return;
    openedLegacyMika.current = true;
    useExplorerStore.getState().setMikaPanelOpen(true);
    void openCloudFolderBotWindow(assetsDir).then(() => openCloudFolderBotChatWindow());
  }, [assetsDir, searchParams]);

  return (
    <Suspense fallback={<ExplorerLoadingShell />}>
      <DesktopFilesPage />
    </Suspense>
  );
}
