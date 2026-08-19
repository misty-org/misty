import { deploymentStorageKey } from "@/api/deployment/api";
import { useEffect } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";

import { useAuth } from "@/features/auth";
import { useSpacesStore } from "./store/useSpacesStore";

import { spaceNotesEnabled } from "@/features/notes";
import { SpaceSectionView } from "./SpaceSectionView";

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
  const { user } = useAuth();
  const location = useLocation();
  const { spaces, loadSpace } = useSpacesStore(
    useShallow((state) => ({ spaces: state.spaces, loadSpace: state.loadSpace })),
  );
  const space = spaces.find((item) => item.id === spaceId);

  useEffect(() => {
    if (spaceId && user) void loadSpace(spaceId);
  }, [loadSpace, spaceId, user]);
  useEffect(() => {
    if (!space || !user?.id) return;
    try {
      window.localStorage.setItem(
        deploymentStorageKey(`misty:last-active-space:${user.id}`),
        space.id,
      );
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
  if (section === "assistant") {
    return <Navigate to={`/agents?spaceId=${encodeURIComponent(spaceId)}`} replace />;
  }

  // Route normalisation is this component's whole job now. The section itself
  // renders from props so the dock can show it in more than one pane, which a
  // single router outlet cannot do.
  return <SpaceSectionView spaceId={spaceId} section={section} studioKind={studioKind} />;
}

function defaultJournalPath(spaceId: string) {
  return `/spaces/${encodeURIComponent(spaceId)}/${spaceNotesEnabled ? "notes" : "drawings"}`;
}
