import { lazy, Suspense } from "react";
import { useLocation } from "react-router-dom";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import type { OfficialApp } from "@/api/apps";
import type { WorkspaceTab } from "@/features/workspace/model";
import { socialProvider } from "@/features/spaces";
import NativeAppSurface from "./NativeAppSurface";
import { isNativeSurfaceId } from "./nativeSurfacePolicy";
import { isTrustedHostApp } from "./trustedHostApps";
import { TrustedAppRouteScope } from "./TrustedAppRouteScope";
import { EmbeddedPlanner as Planner } from "@/features/apps/EmbeddedPlanner";
const Notes = lazy(() =>
  import("@/features/notes/SpaceNotes").then((m) => ({ default: m.SpaceNotes })),
);
const Drawings = lazy(() =>
  import("@/features/drawings/SpaceDrawings").then((m) => ({ default: m.SpaceDrawings })),
);
const Library = lazy(() =>
  import("@/features/spaces/library/SpaceLibrary").then((m) => ({ default: m.SpaceLibrary })),
);
const Social = lazy(() =>
  import("@/features/spaces/chat/SpaceChatEntry").then((m) => ({ default: m.SpaceSocial })),
);
const Inbox = lazy(() =>
  import("@/features/inbox/InboxWorkspace").then((m) => ({ default: m.InboxWorkspace })),
);
const Agents = lazy(() => import("@/features/agents/AgentsPage"));

export interface TrustedAppSurfaceProps {
  app: OfficialApp;
  space?: Space;
  tab?: WorkspaceTab;
  active?: boolean;
  route: string;
}

// Transitional embedded runtime. Remove when the SDK/download migration passes its completion gates.
export function TrustedAppSurface(props: TrustedAppSurfaceProps) {
  if (!isTrustedHostApp(props.app))
    throw new Error("This App is not part of the trusted host build.");
  return (
    <div className="relative h-full min-h-0 bg-charcoal-bg" data-misty-trusted-app={props.app.id}>
      <TrustedAppRouteScope
        appId={props.app.id}
        spaceId={props.space?.id ?? ""}
        route={props.route}
      >
        <Suspense fallback={<div role="status">Opening {props.app.name}…</div>}>
          <TrustedFeature {...props} />
        </Suspense>
      </TrustedAppRouteScope>
    </div>
  );
}
function TrustedFeature(props: TrustedAppSurfaceProps) {
  const location = useLocation();
  const { app, space, tab, active } = props;
  const workspaceId = tab?.id ?? `host-app:${app.id}`;
  if (isNativeSurfaceId(app.id)) {
    const nativeTab: WorkspaceTab = tab ?? {
      id: workspaceId,
      surfaceId: "official-app",
      groupKey: `app:${app.id}`,
      instanceKey: app.id,
      title: app.name,
      route: props.route,
      state: {},
      createdAt: 0,
      lastFocusedAt: 0,
      sidebarVisible: true,
    };
    return <NativeAppSurface surface={app.id} tab={nativeTab} active={active} />;
  }
  if (app.id === "inbox") return <Inbox workspaceId={workspaceId} initialRoute={props.route} />;
  if (app.id === "agents") return <Agents />;
  if (!space) return <div role="status">Choose a Space to open {app.name}.</div>;
  if (app.id === "planner")
    return (
      <Planner
        spaceId={space.id}
        canManage={space.permissions?.["tasks.manage"] !== false}
        canManageIntegrations={space.role === "owner"}
        workspaceTabId={tab?.id}
      />
    );
  if (app.id === "library") return <Library spaceId={space.id} workspaceTabId={tab?.id} />;
  if (app.id === "chat")
    return (
      <Social
        spaceId={space.id}
        spaceName={space.name}
        provider={socialProvider(new URLSearchParams(location.search).get("provider")) ?? "misty"}
        workspaceTabId={tab?.id}
      />
    );
  if (app.id === "journal") {
    const parts = location.pathname.split("/").filter(Boolean);
    return parts[2] === "drawings" ? (
      <Drawings spaceId={space.id} drawingId={parts[3] ?? ""} workspaceTabId={tab?.id} />
    ) : (
      <Notes spaceId={space.id} spaceName={space.name} workspaceTabId={tab?.id} />
    );
  }
  return null;
}
