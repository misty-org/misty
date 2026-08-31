import { useAuth } from "@/features/auth";
import { CalendarDays, GitFork, KanbanSquare } from "lucide-react";
import { rememberedPlannerRoute } from "../../spacesShell/spaceSubpageMemory";
import { SpaceSidebarLink } from "./SpaceSidebarLink";

export function PlannerPanelSidebar(props: {
  spaceId: string;
  section: "tasks" | "agenda" | "goals" | "milestones" | "roadmaps";
  roadmapId: string;
}) {
  const { user } = useAuth();
  const accountId = user?.id ?? "";
  const taskDestination = rememberedPlannerRoute(accountId, props.spaceId, "tasks");
  const agendaDestination = rememberedPlannerRoute(accountId, props.spaceId, "agenda");
  const roadmapDestination = rememberedPlannerRoute(accountId, props.spaceId, "roadmaps");

  return (
    <div className="grid gap-2">
      <nav className="grid gap-1" aria-label="Planner destinations">
        <SpaceSidebarLink
          active={props.section === "tasks"}
          icon={KanbanSquare}
          label="Tasks"
          to={taskDestination}
        />
        <SpaceSidebarLink
          active={props.section === "agenda"}
          icon={CalendarDays}
          label="Agenda"
          to={agendaDestination}
        />
        <SpaceSidebarLink
          active={["goals", "milestones", "roadmaps"].includes(props.section)}
          icon={GitFork}
          label="Roadmaps"
          to={roadmapDestination}
        />
      </nav>
    </div>
  );
}
