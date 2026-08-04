import { lazy, Suspense } from "react";
import { ExplorerLoadingShell } from "./components/ExplorerLoadingShell";

const loadDesktopFilesPage = () => import("./desktop");
const DesktopFilesPage = lazy(loadDesktopFilesPage);

export function preloadDesktopFilesPage(): Promise<unknown> {
  return loadDesktopFilesPage();
}

export default function FilesPage(props: {
  embedded?: boolean;
  workspaceId?: string;
  workspaceTitle?: string;
}) {
  return (
    <Suspense fallback={<ExplorerLoadingShell />}>
      <DesktopFilesPage {...props} />
    </Suspense>
  );
}
