import { rememberedPlannerRoute } from "@/features/spaces";
import {
  useWorkspaceStore,
  WorkspaceAppIcon,
  workspaceSurfaceFromRoute,
} from "@/features/workspace";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  TreeBranch,
  cn,
  navigationDisclosureChevronClass,
  navigationDisclosureLabelClass,
  navigationTreeBranchClass,
  navigationTreeGroupClass,
  navigationTreeItemIconClass,
  navigationTreeRowClass,
  navigationTreeSurfaceClass,
} from "@/shared/ui";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  AgendaDestinationIcon,
  RoadmapsDestinationIcon,
  TasksDestinationIcon,
} from "./NavigatorDestinationIcons";
import { navigatorFocusRingClass, navigatorSubsectionIconClass } from "./styles";
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
    path: rememberedPlannerRoute(props.accountId, props.spaceId, destination.id),
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
      className="grid gap-1"
      data-planner-disclosure="true"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "misty-navigator-row-target group/toggle flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-cream-muted outline-none transition-colors",
            "hover:bg-charcoal-card hover:text-cream-bright",
            navigatorFocusRingClass,
          )}
          aria-label="Planner"
          data-navigator-disclosure-trigger="true"
          title={open ? "Collapse Planner" : "Expand Planner"}
        >
          <span className="grid size-7 shrink-0 place-items-center">
            <WorkspaceAppIcon appId="planner" size="nav" />
          </span>
          <span className={navigationDisclosureLabelClass}>
            <span className="min-w-0 truncate">Planner</span>
            <ChevronRight
              className={cn(
                navigationDisclosureChevronClass,
                "size-4 transition-transform duration-150 motion-reduce:transition-none group-data-[state=open]/toggle:rotate-90",
              )}
              aria-hidden="true"
              data-chevron-placement="inline"
            />
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className={navigationTreeGroupClass} role="group" aria-label="Planner destinations">
          {destinations.map(({ id, label, icon: Icon, path }, index) => {
            const active = id === activeDestination;
            return (
              <Link
                key={id}
                to={path}
                onClick={() => openWorkspaceRoute(path)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  navigationTreeRowClass,
                  "misty-navigator-row-target rounded-md text-cream-muted no-underline outline-none transition-colors hover:text-cream-bright",
                  navigatorFocusRingClass,
                  active && "text-cream-bright",
                )}
              >
                <TreeBranch
                  className={navigationTreeBranchClass}
                  first={index === 0}
                  last={index === destinations.length - 1}
                />
                <span
                  className={cn(
                    navigationTreeSurfaceClass,
                    "group-hover/tree-row:bg-charcoal-hover",
                    active && "bg-charcoal-card/80",
                  )}
                  data-tree-row-surface="true"
                >
                  <span className={navigatorSubsectionIconClass}>
                    <Icon
                      className={navigationTreeItemIconClass}
                      strokeWidth={1.85}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function plannerDestinationFromRoute(route: string): PlannerDestinationId {
  try {
    const part = new URL(route, "https://misty.local").pathname.split("/").filter(Boolean)[3];
    if (part === "agenda" || part === "calendar") return "agenda";
    if (part === "goals" || part === "milestones" || part === "roadmaps") return "roadmaps";
  } catch {
    // A malformed remembered route falls back to Tasks, just like route memory does.
  }
  return "tasks";
}

function openWorkspaceRoute(path: string) {
  const surface = workspaceSurfaceFromRoute(path);
  if (surface) useWorkspaceStore.getState().openSurface(surface);
}
