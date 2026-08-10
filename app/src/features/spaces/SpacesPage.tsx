import { useEffect } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";

import { useAuth } from "@/features/auth";
import { isWebBuild } from "@/shared/platform/buildTarget";
import { Button, EmptyState, PermissionState } from "@/shared/ui";
import { useSpacesStore } from "./store/useSpacesStore";

import { SpaceDrawings } from "@/features/drawings";
import { SpaceNotes, spaceNotesEnabled } from "@/features/notes";
import { SpaceChat } from "@/features/spaces/chat";
import { SpaceLibrary } from "@/features/spaces/library";
import { SpacePlanner } from "@/features/spaces/planner";
import { SpaceSettings } from "./components/SpaceSettings";
import { SpacePageLoadingPlaceholder } from "./components/SpacesLoadingPlaceholder";

export { default, SpacesIndexRedirect } from "./components/SpacesShell";

const validSpaceSections = new Set([
  "chat",
  "planner",
  "notes",
  "drawings",
  "library",
  // Legacy URL segment, kept so saved bookmarks and deep links still resolve.
  // It renders no surface of its own; it redirects to /agents?spaceId=.
  "assistant",
  "members",
  "settings",
]);
const validSettingsSections = new Set(["general", "members", "connections", "suggestions"]);
const validPlannerViews = new Set(["board", "list", "calendar"]);

export function SpaceDetail() {
  const {
    spaceId = "",
    section = spaceNotesEnabled ? "notes" : "drawings",
    studioKind = "",
  } = useParams();
  const { user, accounts, transitioning } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { spaces, snapshotReady, referenceOnly, loading, error, load, loadSpace } = useSpacesStore(
    useShallow((state) => ({
      spaces: state.spaces,
      snapshotReady: state.snapshotReady,
      referenceOnly: state.referenceOnly,
      loading: state.loading,
      error: state.error,
      load: state.load,
      loadSpace: state.loadSpace,
    })),
  );
  const space = spaces.find((item) => item.id === spaceId);

  useEffect(() => {
    if (spaceId && user) void loadSpace(spaceId);
  }, [loadSpace, spaceId, user]);
  useEffect(() => {
    if (!space || !user?.id) return;
    try {
      window.localStorage.setItem(`misty:last-active-space:${user.id}`, space.id);
    } catch {
      /* local route memory can be unavailable in private contexts */
    }
  }, [space, user?.id]);

  if (section === "files") {
    return <Navigate to={`/spaces/${encodeURIComponent(spaceId)}/library`} replace />;
  }
  if (section === "notes" && !spaceNotesEnabled) {
    return <Navigate to={`/spaces/${encodeURIComponent(spaceId)}/drawings`} replace />;
  }
  if (section === "tasks") {
    const view = validPlannerViews.has(studioKind) ? `/${studioKind}` : "";
    return (
      <Navigate
        to={`/spaces/${encodeURIComponent(spaceId)}/planner${view}${location.search}${location.hash}`}
        replace
      />
    );
  }
  if (section === "planner") {
    const routeParts = location.pathname.split("/").filter(Boolean);
    const plannerPart = routeParts[3] ?? "";
    if (!plannerPart) {
      return (
        <Navigate
          to={`/spaces/${encodeURIComponent(spaceId)}/planner/tasks/board${location.search}${location.hash}`}
          replace
        />
      );
    }
    if (plannerPart === "board" || plannerPart === "list") {
      return (
        <Navigate
          to={`/spaces/${encodeURIComponent(spaceId)}/planner/tasks/${plannerPart}${location.search}${location.hash}`}
          replace
        />
      );
    }
    if (plannerPart === "calendar") {
      return (
        <Navigate
          to={`/spaces/${encodeURIComponent(spaceId)}/planner/agenda/month${location.search}${location.hash}`}
          replace
        />
      );
    }
    if (plannerPart === "tasks" && !["board", "list"].includes(routeParts[4] ?? "")) {
      return (
        <Navigate
          to={`/spaces/${encodeURIComponent(spaceId)}/planner/tasks/board${location.search}${location.hash}`}
          replace
        />
      );
    }
    if (plannerPart === "agenda" && !["month", "week", "day"].includes(routeParts[4] ?? "")) {
      return (
        <Navigate
          to={`/spaces/${encodeURIComponent(spaceId)}/planner/agenda/month${location.search}${location.hash}`}
          replace
        />
      );
    }
    if (!["tasks", "agenda", "goals", "milestones", "roadmaps"].includes(plannerPart)) {
      return (
        <Navigate
          to={`/spaces/${encodeURIComponent(spaceId)}/planner/tasks/board${location.search}${location.hash}`}
          replace
        />
      );
    }
  }
  if (!validSpaceSections.has(section)) {
    return <Navigate to={defaultJournalPath(spaceId)} replace />;
  }
  if (section === "settings" && studioKind === "integrations") {
    return <Navigate to={`/spaces/${encodeURIComponent(spaceId)}/settings/connections`} replace />;
  }
  if (section === "settings" && studioKind && !validSettingsSections.has(studioKind)) {
    return <Navigate to={`/spaces/${encodeURIComponent(spaceId)}/settings/general`} replace />;
  }
  if (section === "members") {
    return <Navigate to={`/spaces/${encodeURIComponent(spaceId)}/settings/members`} replace />;
  }

  const returnPath = `${location.pathname}${location.search}${location.hash}`;
  if (transitioning) return <SpacePageLoadingPlaceholder label="Switching accounts" />;

  if (!user && accounts.length > 0) {
    return <Navigate to="/signin" state={{ from: returnPath }} replace />;
  }

  if (!user) {
    return (
      <PermissionState
        className="h-full"
        title="Log in to view this Space"
        description="Sign in to your Misty account to open Spaces and see their content."
        action={
          <Button
            type="button"
            onClick={() =>
              navigate("/signin", {
                state: { from: returnPath },
              })
            }
          >
            Log in
          </Button>
        }
      />
    );
  }

  if (!snapshotReady && error) {
    return (
      <SpacePageLoadingPlaceholder
        label="Loading Space"
        onRetry={() => {
          void load({ force: true }).then(() => {
            if (useSpacesStore.getState().snapshotReady) void loadSpace(spaceId);
          });
        }}
      />
    );
  }

  if (!snapshotReady || (!space && loading)) {
    return <SpacePageLoadingPlaceholder />;
  }

  if (!space && spaces.length > 0) {
    const fallback = spaces[0];
    return <Navigate to={defaultJournalPath(fallback.id)} replace />;
  }

  if (!space) {
    return (
      <EmptyState
        className="h-full"
        title="This Space isn’t available"
        description="This Space may have been removed, or you may no longer have access."
      />
    );
  }

  const canManageMisty = space.permissions?.["space.invite"] === true;
  if (space.kind === "misty" && section !== "chat" && !(section === "settings" && canManageMisty)) {
    return <Navigate to={`/spaces/${encodeURIComponent(spaceId)}/chat`} replace />;
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      {section === "library" ? (
        isWebBuild ? (
          <PermissionState
            className="h-full"
            title="Space Library is available in the Misty desktop app"
            description={
              "This Library currently depends on local-device file indexing and transfers. " +
              "Cloud-backed Space chat, planning, notes, and drawings are available on the web."
            }
          />
        ) : space.permissions?.["library.view"] === false ? (
          <SpacePermissionDenied
            title="Library access required"
            detail="You do not have permission to view this Space's Library."
          />
        ) : (
          <SpaceLibrary key={`library:${spaceId}`} spaceId={spaceId} />
        )
      ) : section === "planner" ? (
        space.permissions?.["tasks.view"] === false ? (
          <SpacePermissionDenied
            title="Planner access required"
            detail="Ask a Space owner to grant Planner access."
          />
        ) : (
          <SpacePlanner
            key={`planner:${spaceId}`}
            spaceId={spaceId}
            canManage={!referenceOnly && space.permissions?.["tasks.manage"] !== false}
            canManageIntegrations={!referenceOnly && space.role === "owner"}
          />
        )
      ) : section === "notes" ? (
        <SpaceNotes key={`notes:${spaceId}`} spaceId={spaceId} spaceName={space.name} />
      ) : section === "drawings" ? (
        <SpaceDrawings
          key={`drawings:${spaceId}:${studioKind}`}
          spaceId={spaceId}
          drawingId={studioKind}
        />
      ) : section === "assistant" ? (
        <Navigate to={`/agents?spaceId=${encodeURIComponent(spaceId)}`} replace />
      ) : section === "settings" ? (
        <SpaceSettings
          key={`settings:${spaceId}:${studioKind}`}
          spaceId={spaceId}
          section={studioKind}
        />
      ) : space.permissions?.["messages.read"] === false ? (
        <SpacePermissionDenied
          title="Chat access required"
          detail="You do not have permission to read this Space's messages."
        />
      ) : (
        <SpaceChat key={`chat:${spaceId}`} spaceId={spaceId} />
      )}
    </div>
  );
}

function defaultJournalPath(spaceId: string) {
  return `/spaces/${encodeURIComponent(spaceId)}/${spaceNotesEnabled ? "notes" : "drawings"}`;
}

function SpacePermissionDenied({ title, detail }: { title: string; detail: string }) {
  return <PermissionState className="h-full" title={title} description={detail} />;
}
