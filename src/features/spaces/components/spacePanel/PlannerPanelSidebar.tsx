import { useEffect, useState } from "react";
import { CalendarClock, Check, GitFork, ListTodo, Plus, UserRound, UserRoundX } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import type { SpaceCalendarSource } from "@/models/interfaces/features/spaces/types";
import type { SpaceRoadmap } from "@/models/interfaces/features/spaces/plannerExpansionTypes";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import { useSpaceAgendaPreferences } from "@/stores/spaces/useSpaceAgendaPreferences";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { Button } from "@/ui";
import { rememberedPlannerRoute } from "../../spacesShell/spaceSubpageMemory";
import { SpaceSidebarPageSection } from "../SpaceSidebarPageSection";
import { SpaceSidebarLink } from "./SpaceSidebarLink";

export function PlannerPanelSidebar(props: {
  spaceId: string;
  section: "tasks" | "agenda" | "roadmaps";
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
  const [sources, setSources] = useState<SpaceCalendarSource[]>([]);
  const { visibility, setVisibility } = useSpaceAgendaPreferences(user?.id ?? "", props.spaceId);
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

  useEffect(() => {
    void spacesApi
      .roadmaps(props.spaceId)
      .then((result) => setRoadmaps(result.roadmaps))
      .catch(() => setRoadmaps([]));
    void spacesApi
      .calendarSources(props.spaceId)
      .then((result) => setSources(result.sources))
      .catch(() => setSources([]));
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
        <AgendaLinks sources={sources} visibility={visibility} setVisibility={setVisibility} />
      </SpaceSidebarPageSection>
      <SpaceSidebarPageSection
        active={props.section === "roadmaps"}
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
        <nav className="grid gap-1" aria-label="Available roadmaps">
          {roadmaps.map((roadmap) => (
            <SpaceSidebarLink
              key={roadmap.id}
              active={roadmap.id === props.roadmapId}
              icon={GitFork}
              label={roadmap.name}
              to={`${base}/roadmaps/${encodeURIComponent(roadmap.id)}`}
            />
          ))}
        </nav>
        {!roadmaps.length ? (
          <p className="px-2 py-1 text-[11px] text-muted-foreground">None yet</p>
        ) : null}
      </SpaceSidebarPageSection>
    </div>
  );
}

function TasksLinks({ path, search }: { path: string; search: URLSearchParams }) {
  const hasFilter = ["mine", "assignee", "due", "status", "priority"].some((key) =>
    search.has(key),
  );
  return (
    <nav className="grid gap-1" aria-label="Task shortcuts">
      <SpaceSidebarLink active={!hasFilter} icon={ListTodo} label="All tasks" to={path} />
      <SpaceSidebarLink
        active={search.get("mine") === "1"}
        icon={UserRound}
        label="Assigned to me"
        to={`${path}?mine=1`}
      />
      <SpaceSidebarLink
        active={search.get("assignee") === "unassigned"}
        icon={UserRoundX}
        label="Unassigned"
        to={`${path}?assignee=unassigned`}
      />
      <SpaceSidebarLink
        active={search.get("due") === "week"}
        icon={CalendarClock}
        label="Due this week"
        to={`${path}?due=week`}
      />
    </nav>
  );
}

function AgendaLinks({
  sources,
  visibility,
  setVisibility,
}: {
  sources: SpaceCalendarSource[];
  visibility: { tasks: boolean; roadmap: boolean; hiddenSources: string[] };
  setVisibility: (
    next: typeof visibility | ((current: typeof visibility) => typeof visibility),
  ) => void;
}) {
  const Toggle = ({
    active,
    label,
    onClick,
  }: {
    active: boolean;
    label: string;
    onClick: () => void;
  }) => (
    <Button
      type="button"
      variant="ghost"
      className="h-8 w-full justify-start gap-2 px-2.5 text-left text-xs font-normal text-muted-foreground hover:bg-sidebar-accent/25 hover:text-foreground"
      onClick={onClick}
    >
      <span className="grid size-4 place-items-center rounded border border-border">
        {active ? <Check className="size-3" /> : null}
      </span>
      <span className="truncate">{label}</span>
    </Button>
  );
  return (
    <div>
      <p className="mb-1 px-2 text-[11px] font-medium text-muted-foreground">Visible calendars</p>
      <div className="grid gap-0.5">
        <Toggle
          active={visibility.tasks}
          label="Task deadlines"
          onClick={() => setVisibility((current) => ({ ...current, tasks: !current.tasks }))}
        />
        <Toggle
          active={visibility.roadmap}
          label="Roadmap dates"
          onClick={() => setVisibility((current) => ({ ...current, roadmap: !current.roadmap }))}
        />
        {sources.map((source) => (
          <Toggle
            key={source.id}
            active={!visibility.hiddenSources.includes(source.id)}
            label={source.display_name}
            onClick={() =>
              setVisibility((current) => ({
                ...current,
                hiddenSources: current.hiddenSources.includes(source.id)
                  ? current.hiddenSources.filter((id) => id !== source.id)
                  : [...current.hiddenSources, source.id],
              }))
            }
          />
        ))}
      </div>
    </div>
  );
}
