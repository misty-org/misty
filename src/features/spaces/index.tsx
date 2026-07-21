import { useEffect } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";

import { ErrorState, LoadingState, PermissionState } from "@/ui";
import { Button } from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";

import { SpaceNotes } from "@/features/notes/SpaceNotes";
import { SpaceChat } from "./SpaceChat";
import { SpaceAssistant } from "./SpaceAssistant";
import { SpaceLibrary } from "./SpaceLibrary";
import { SpaceTasksCalendar } from "./SpaceTasksCalendar";
import { SpaceMembers } from "./components/SpaceMembers";
import { SpaceSettings } from "./components/SpaceSettings";

export { default, PersonalSpaceRedirect } from "./components/SpacesShell";

const validSpaceSections = new Set([
  "chat",
  "tasks",
  "notes",
  "library",
  "assistant",
  "members",
  "settings",
]);
const validSettingsSections = new Set(["general", "chat", "integrations"]);

export function SpaceDetail() {
  const { spaceId = "", section = "chat", studioKind = "" } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { spaces, snapshotReady, loading, error, loadSpace, clearError } = useSpacesStore(
    useShallow((state) => ({
      spaces: state.spaces,
      snapshotReady: state.snapshotReady,
      loading: state.loading,
      error: state.error,
      loadSpace: state.loadSpace,
      clearError: state.clearError,
    })),
  );
  const space = spaces.find((item) => item.id === spaceId);

  useEffect(() => {
    if (spaceId && user) void loadSpace(spaceId);
  }, [loadSpace, spaceId, user?.id]);

  if (section === "files") {
    return <Navigate to={`/spaces/${encodeURIComponent(spaceId)}/library`} replace />;
  }
  if (!validSpaceSections.has(section)) {
    return <Navigate to={`/spaces/${encodeURIComponent(spaceId)}/chat`} replace />;
  }
  if (section === "settings" && studioKind && !validSettingsSections.has(studioKind)) {
    return <Navigate to={`/spaces/${encodeURIComponent(spaceId)}/settings/general`} replace />;
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
                state: { from: `${location.pathname}${location.search}${location.hash}` },
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
      <ErrorState
        className="h-full"
        title="Spaces unavailable"
        description="Misty could not confirm your Space access. Try again when the service is available."
        action={
          <Button type="button" variant="outline" onClick={() => void loadSpace(spaceId)}>
            Try again
          </Button>
        }
      />
    );
  }

  if (!snapshotReady || (!space && loading)) {
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
      {section === "library" ? (
        space.permissions?.["library.view"] === false ? (
          <SpacePermissionDenied
            title="Library access required"
            detail="You do not have permission to view this Space's Library."
          />
        ) : (
          <SpaceLibrary key={`library:${spaceId}`} spaceId={spaceId} />
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
      ) : section === "notes" ? (
        space.permissions?.["library.view"] === false ? (
          <SpacePermissionDenied
            title="Notes access required"
            detail="You do not have permission to view this Space's Notes."
          />
        ) : (
          <SpaceNotes key={`notes:${spaceId}`} spaceId={spaceId} spaceName={space.name} />
        )
      ) : section === "assistant" ? (
        <SpaceAssistant
          key={`assistant:${user.id}:${spaceId}`}
          accountId={user.id}
          spaceId={spaceId}
          spaceName={space.name}
          permissions={space.permissions}
        />
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
