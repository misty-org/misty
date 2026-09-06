import {
  useWorkspaceStore,
  WorkspaceAppIcon,
  workspaceSurfaceFromRoute,
} from "@/features/workspace";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  NavigationSectionButton,
  NavigationTreeItem,
  navigationMenuGroupClass,
} from "@/shared/ui";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  AgendaDestinationIcon,
  RoadmapsDestinationIcon,
  TasksDestinationIcon,
} from "./NavigatorDestinationIcons";

import { useNavigatorDisclosureState } from "./useNavigatorDisclosureState";

type PlannerDestinationId = "tasks" | "agenda" | "roadmaps";

const plannerDestinationDetails = [
  { id: "tasks" as const, label: "Tasks", icon: TasksDestinationIcon },
  { id: "agenda" as const, label: "Agenda", icon: AgendaDestinationIcon },
  { id: "roadmaps" as const, label: "Roadmaps", icon: RoadmapsDestinationIcon },
];

export function PlannerNavigatorDisclosure(props: {
  accountId: string;
  spaceId: string;
  active: boolean;
  activeRoute: string;
  path: string;
}) {
  const [open, setOpen] = useNavigatorDisclosureState(props.accountId, "planner", props.active);
  const wasActiveRef = useRef(props.active);
  const activeDestination = props.active ? plannerDestinationFromRoute(props.activeRoute) : null;
  const destinations = plannerDestinationDetails.map((destination) => ({
    ...destination,
    path: plannerRoute(props.path, destination.id),
  }));

  useEffect(() => {
    const becameActive = props.active && !wasActiveRef.current;
    wasActiveRef.current = props.active;
    if (becameActive) setOpen(true);
  }, [props.active, setOpen]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={`${navigationMenuGroupClass} w-full min-w-0`}
      data-planner-disclosure="true"
    >
      <CollapsibleTrigger asChild>
        <NavigationSectionButton
          icon={<WorkspaceAppIcon appId={"planner"} size="nav" />}
          label={"Planner"}
          open={open}
          aria-label={"Planner"}
          data-navigator-disclosure-trigger="true"
          title={`${open ? "Collapse" : "Expand"} ${"Planner"}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className={navigationMenuGroupClass} role="group" aria-label="Planner destinations">
          {destinations.map(({ id, label, icon: Icon, path }, index) => {
            const active = id === activeDestination;
            return (
              <NavigationTreeItem
                key={id}
                asChild
                icon={<Icon aria-hidden />}
                label={label}
                selected={active}
                last={index === destinations.length - 1}
              >
                <Link
                  to={path}
                  onClick={() => {
                    openWorkspaceRoute(path);
                  }}
                />
              </NavigationTreeItem>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function plannerDestinationFromRoute(route: string): PlannerDestinationId {
  try {
    const part = new URL(route, "https://misty.local").searchParams.get("view");
    if (part === "agenda" || part === "calendar") return "agenda";
    if (part === "goals" || part === "milestones" || part === "roadmaps") return "roadmaps";
  } catch {
    // A malformed remembered route falls back to Tasks, just like route memory does.
  }
  return "tasks";
}

function plannerRoute(route: string, view: PlannerDestinationId) {
  const url = new URL(route, "https://misty.local");
  url.searchParams.set("view", view);
  return `${url.pathname}${url.search}`;
}

function openWorkspaceRoute(path: string) {
  const surface = workspaceSurfaceFromRoute(path);
  if (surface) useWorkspaceStore.getState().openSurface(surface);
}
