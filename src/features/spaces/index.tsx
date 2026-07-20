import { useEffect } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";

import { ErrorState, LoadingState, PermissionState } from "@/components/ui/state-view";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth/AuthContext";
import { useSpacesStore } from "@/stores/useSpacesStore";

import { AgentCenter } from "@/pages/Agents/AgentCenter";
import type { SpaceStudioKind } from "@/pages/Studio";
import { SpaceChat } from "./SpaceChat";
import { SpaceLibrary } from "./SpaceLibrary";
import { SpaceTasksCalendar } from "./SpaceTasksCalendar";
import { SpaceMembers } from "./components/SpaceMembers";
import { SpaceSettings } from "./components/SpaceSettings";

export { default, PersonalSpaceRedirect } from "./components/SpacesShell";

export function SpaceDetail() {
  const { spaceId = "", section = "chat", studioKind = "agents" } = useParams();
  const [routeSearchParams] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { spaces, loading, error, loadSpace, clearError } = useSpacesStore(
    useShallow((state) => ({
      spaces: state.spaces,
      loading: state.loading,
      error: state.error,
      loadSpace: state.loadSpace,
      clearError: state.clearError,
    })),
  );
  const space = spaces.find((item) => item.id === spaceId);

  useEffect(() => {
    if (spaceId) void loadSpace(spaceId);
  }, [loadSpace, spaceId, user?.id]);

  useEffect(() => {
    if (section === "files") {
      navigate(`/spaces/${encodeURIComponent(spaceId)}/library`, { replace: true });
    }
  }, [navigate, section, spaceId]);

  if (!space && loading) {
    return (
      <LoadingState
        className="h-full"
        title="Loading Space"
        description="Getting the latest Space details…"
      />
    );
  }

  if (!space) {
    return (
      <ErrorState
        className="h-full"
        title="Space unavailable"
        description="This Space may have been removed, or you may no longer have access."
      />
    );
  }

  const query = routeSearchParams.size ? `?${routeSearchParams}` : "";

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      {error ? (
        <Button
          className="absolute left-1/2 top-3 z-20 max-w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 shadow-md"
          type="button"
          variant="destructive"
          onClick={clearError}
        >
          <span className="truncate">{error}</span>
        </Button>
      ) : null}
      {section === "library" || section === "files" ? (
        space.permissions?.["library.view"] === false ? (
          <SpacePermissionDenied
            title="Library access required"
            detail="You do not have permission to view this Space's Library."
          />
        ) : (
          <SpaceLibrary key={`library:${spaceId}`} spaceId={spaceId} />
        )
      ) : section === "studio" ? (
        <Navigate
          to={`/spaces/${encodeURIComponent(spaceId)}/agents/studio/${normalizeStudioKind(studioKind)}${query}`}
          replace
        />
      ) : section === "agents" ? (
        space.permissions?.["agents.run"] === false &&
        space.permissions?.["studio.view"] === false ? (
          <SpacePermissionDenied
            title="Agent access required"
            detail="Ask a Space owner to grant Agent or Studio access."
          />
        ) : (
          <AgentCenter
            key={`agents:${spaceId}:${studioKind}`}
            spaceId={spaceId}
            spaceName={space.name ?? "This Space"}
            canRun={space.permissions?.["agents.run"] !== false}
            canViewStudio={space.permissions?.["studio.view"] !== false}
          />
        )
      ) : section === "tasks" ? (
        space.permissions?.["tasks.view"] === false ? (
          <SpacePermissionDenied
            title="Task access required"
            detail="Ask a Space owner to grant task access."
          />
        ) : (
          <SpaceTasksCalendar
            key={`tasks:${spaceId}`}
            spaceId={spaceId}
            canManage={space.permissions?.["tasks.manage"] !== false}
            canManageIntegrations={space.permissions?.["integrations.manage"] !== false}
          />
        )
      ) : section === "members" ? (
        <SpaceMembers key={`members:${spaceId}`} spaceId={spaceId} />
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

function SpacePermissionDenied({ title, detail }: { title: string; detail: string }) {
  return <PermissionState className="h-full" title={title} description={detail} />;
}

function normalizeStudioKind(value: string): SpaceStudioKind {
  return value === "workflows" ? "workflows" : "agents";
}
