import { canonicalSpaceRoute, socialProviderFromRoute } from "@/features/spaces";
import { OfficialAppRuntimePage } from "@/features/apps";
import {
  WorkspaceTabRouteScope,
  type WorkspaceSurfaceId,
  type WorkspaceTab,
} from "@/features/workspace/core";
import { ErrorState, LoadingState } from "@/shared/ui";
import { lazy, Suspense } from "react";

const MobileSpaceSectionView = lazy(() =>
  import("@/features/spaces/SpaceSectionView").then((module) => ({
    default: module.SpaceSectionView,
  })),
);

export type MobileSurfaceRegistration =
  | "space"
  | "inbox"
  | "browser"
  | "files"
  | "agents"
  | "official-app"
  | "desktop-handoff"
  | "excluded"
  | "unsupported";

export const mobileSurfaceRegistry: Readonly<
  Record<WorkspaceSurfaceId, MobileSurfaceRegistration>
> = {
  space: "space",
  inbox: "desktop-handoff",
  browser: "desktop-handoff",
  files: "desktop-handoff",
  agents: "desktop-handoff",
  "official-app": "official-app",
  code: "desktop-handoff",
  terminal: "desktop-handoff",
  transfers: "desktop-handoff",
  extension: "excluded",
  marketplace: "excluded",
  home: "unsupported",
};

export function MobileWorkspaceSurface(props: { tab: WorkspaceTab; active?: boolean }) {
  const scopedTab =
    props.tab.surfaceId === "space"
      ? { ...props.tab, route: canonicalSpaceRoute(props.tab.route) }
      : props.tab;

  return (
    <WorkspaceTabRouteScope tab={scopedTab}>
      <Suspense
        fallback={<LoadingState className="h-full" label="Loading" title="Loading surface" />}
      >
        <MobileWorkspaceSurfaceContent tab={scopedTab} />
      </Suspense>
    </WorkspaceTabRouteScope>
  );
}

function MobileWorkspaceSurfaceContent(props: { tab: WorkspaceTab }) {
  const { tab } = props;
  switch (tab.surfaceId) {
    case "official-app":
      return (
        <OfficialAppRuntimePage
          appId={tab.groupKey.startsWith("app:") ? tab.groupKey.slice(4) : tab.instanceKey}
          tab={tab}
          active
        />
      );
    case "space":
      return <MobileSpacePane tab={tab} />;
    case "home":
      return <UnsupportedMobileSurface title="Home" />;
    case "terminal":
    case "code":
    case "transfers":
    case "inbox":
    case "browser":
    case "files":
    case "agents":
      return <UnsupportedMobileSurface title={tab.title} />;
    case "extension":
    case "marketplace":
      return <UnsupportedMobileSurface title="App" />;
  }
}

function MobileSpacePane(props: { tab: WorkspaceTab }) {
  const route = parseSpaceTabRoute(props.tab.route);
  if (!route) {
    return (
      <ErrorState
        className="h-full"
        title="This Space view could not be opened"
        description="Choose a Space view from the navigation to replace this invalid tab route."
      />
    );
  }
  return (
    <MobileSpaceSectionView
      spaceId={route.spaceId}
      section={route.section}
      studioKind={route.studioKind}
      workspaceTabId={props.tab.id}
    />
  );
}

function UnsupportedMobileSurface(props: { title: string }) {
  return (
    <ErrorState
      className="h-full"
      title={`${props.title} is unavailable here`}
      description="Return to Home and choose a mobile-supported surface."
    />
  );
}

function parseSpaceTabRoute(route: string): {
  spaceId: string;
  section: string;
  studioKind: string;
} | null {
  const canonicalRoute = canonicalSpaceRoute(route);
  const parts = canonicalRoute.split("?")[0].split("#")[0].split("/").filter(Boolean);
  if (parts[0] !== "spaces" || !parts[1]) return null;
  const section = parts[2] ?? "";
  return {
    spaceId: safeDecode(parts[1]),
    section,
    studioKind: section === "social" ? socialProviderFromRoute(canonicalRoute) : (parts[3] ?? ""),
  };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
