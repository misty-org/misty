import { useEffect, useState } from "react";
import { CalendarDays, Flag, GitFork, KanbanSquare, List, Plus, Target } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import type { SpaceRoadmap } from "@/models/interfaces/features/spaces/plannerExpansionTypes";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { Button } from "@/ui";
import { rememberedPlannerRoute } from "../../spacesShell/spaceSubpageMemory";
import { SpaceSidebarPageSection } from "../SpaceSidebarPageSection";
import { SpaceSidebarLink } from "./SpaceSidebarLink";

export function PlannerPanelSidebar(props: {
  spaceId: string;
  section: "tasks" | "agenda" | "goals" | "milestones" | "roadmaps";
  roadmapId: string;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const canManage = useSpacesStore(
    (state) =>
      state.spaces.find((space) => space.id === props.spaceId)?.permissions?.["tasks.manage"] !==
      false,
  );
  const [roadmaps, setRoadmaps] = useState<SpaceRoadmap[]>([]);
  const base = `/spaces/${encodeURIComponent(props.spaceId)}/planner`;
  const accountId = user?.id ?? "";
  const taskDestination = rememberedPlannerRoute(accountId, props.spaceId, "tasks");
  const agendaDestination = rememberedPlannerRoute(accountId, props.spaceId, "agenda");
  const roadmapDestination = rememberedPlannerRoute(accountId, props.spaceId, "roadmaps");
  const taskRoute = new URL(
    props.section === "tasks" ? `${location.pathname}${location.search}` : taskDestination,
    "https://misty.local",
  );
  const taskPath = taskRoute.pathname;
  const taskSearch = taskRoute.searchParams;
  const agendaRoute = new URL(
    props.section === "agenda" ? `${location.pathname}${location.search}` : agendaDestination,
    "https://misty.local",
  );

  useEffect(() => {
    void spacesApi
      .roadmaps(props.spaceId)
      .then((result) => setRoadmaps(result.roadmaps))
      .catch(() => setRoadmaps([]));
  }, [props.roadmapId, props.section, props.spaceId, user?.id]);

  return (
    <div className="grid gap-2">
      <SpaceSidebarPageSection
        active={props.section === "tasks"}
        label="Tasks"
        to={taskDestination}
      >
        <TasksLinks path={taskPath} search={taskSearch} />
      </SpaceSidebarPageSection>
      <SpaceSidebarPageSection
        active={props.section === "agenda"}
        label="Agenda"
        to={agendaDestination}
      >
        <AgendaLinks
          active={props.section === "agenda"}
          path={agendaRoute.pathname}
          search={agendaRoute.searchParams}
        />
      </SpaceSidebarPageSection>
      <SpaceSidebarPageSection
        active={["goals", "milestones", "roadmaps"].includes(props.section)}
        label="Roadmap"
        to={roadmapDestination}
        count={roadmaps.length}
        action={
          canManage ? (
            <Button
              aria-label="New roadmap"
              className="size-6 shrink-0 opacity-0 shadow-none group-hover/sidebar-page:opacity-100 focus-visible:opacity-100"
              size="icon"
              variant="ghost"
              onClick={() => navigate(`${base}/roadmaps?create=roadmap`)}
            >
              <Plus className="size-3.5" />
            </Button>
          ) : undefined
        }
      >
        <nav className="grid gap-1" aria-label="Roadmap destinations">
          <SpaceSidebarLink
            active={props.section === "goals"}
            icon={Target}
            label="Goals"
            to={`${base}/goals`}
          />
          <SpaceSidebarLink
            active={props.section === "milestones"}
            icon={Flag}
            label="Milestones"
            to={`${base}/milestones`}
          />
          <SpaceSidebarLink
            active={props.section === "roadmaps" && !props.roadmapId}
            icon={GitFork}
            label="Views"
            to={`${base}/roadmaps`}
          />
        </nav>
      </SpaceSidebarPageSection>
    </div>
  );
}

function TasksLinks({ path, search }: { path: string; search: URLSearchParams }) {
  const base = path.replace(/\/(?:board|list)$/, "");
  const query = search.toString();
  const destination = (view: "board" | "list") => `${base}/${view}${query ? `?${query}` : ""}`;
  return (
    <nav className="grid gap-1" aria-label="Task views">
      <SpaceSidebarLink
        active={!path.endsWith("/list")}
        icon={KanbanSquare}
        label="Board"
        to={destination("board")}
      />
      <SpaceSidebarLink
        active={path.endsWith("/list")}
        icon={List}
        label="List"
        to={destination("list")}
      />
    </nav>
  );
}

function AgendaLinks({
  active,
  path,
  search,
}: {
  active: boolean;
  path: string;
  search: URLSearchParams;
}) {
  const query = search.toString();
  const destination = `${path}${query ? `?${query}` : ""}`;
  return (
    <nav className="grid gap-1" aria-label="Agenda destinations">
      <SpaceSidebarLink active={active} icon={CalendarDays} label="Calendar" to={destination} />
    </nav>
  );
}
