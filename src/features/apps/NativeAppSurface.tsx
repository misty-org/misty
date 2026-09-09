import { lazy, Suspense } from "react";
import type { WorkspaceTab } from "@/features/workspace/model";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import type { NativeSurfaceId } from "./nativeSurfacePolicy";

const Browser = lazy(() =>
  import("@/features/browser/BrowserWorkspace").then((module) => ({
    default: module.BrowserWorkspace,
  })),
);
const Files = lazy(() => import("@/features/files/explorer"));
const MobileFiles = lazy(() =>
  import("@/features/files/mobile/MobileFilesPage").then((module) => ({
    default: module.MobileFilesPage,
  })),
);
const Transfers = lazy(() =>
  import("@/features/transfers/TransfersPage").then((module) => ({
    default: module.TransfersWorkspacePanel,
  })),
);

/** Trusted native service UI. No package code or package-selected paths run here. */
export default function NativeAppSurface(props: {
  surface: NativeSurfaceId;
  tab: WorkspaceTab;
  active?: boolean;
}) {
  const { tab, surface } = props;
  const transfers =
    surface === "files" &&
    new URL(tab.route, "https://misty.local").searchParams.get("view") === "transfers";
  return (
    <div className="absolute inset-0 bg-charcoal-bg" data-misty-native-surface={surface}>
      <Suspense fallback={<div role="status">Opening {tab.title}…</div>}>
        {surface === "browser" ? <Browser tab={tab} /> : null}
        {surface === "files" ? (
          transfers ? (
            <Transfers workspaceId={tab.id} />
          ) : isNativeMobileBuild ? (
            <MobileFiles />
          ) : (
            <Files embedded workspaceId={tab.id} workspaceTitle={tab.title} />
          )
        ) : null}
        {surface === "code" ? <div role="alert">Open Discover to update Code to its downloadable app package.</div> : null}
        {surface === "terminal" ? (
          <div role="alert">Open Discover to update Terminal to its downloadable app package.</div>
        ) : null}
      </Suspense>
    </div>
  );
}
