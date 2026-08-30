import { routes } from "@/features/app-shell";
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
import { ExplorerDestinationIcon, TransfersDestinationIcon } from "./NavigatorDestinationIcons";
import { navigatorFocusRingClass, navigatorSubsectionIconClass } from "./styles";
import { useNavigatorDisclosureState } from "./useNavigatorDisclosureState";

type FilesDestinationId = "explorer" | "transfers";

const destinations = [
  {
    id: "explorer" as const,
    label: "Explorer",
    icon: ExplorerDestinationIcon,
    path: routes.files,
  },
  {
    id: "transfers" as const,
    label: "Transfers",
    icon: TransfersDestinationIcon,
    path: routes.transfers,
  },
];

export function FilesNavigatorDisclosure(props: {
  accountId: string;
  activeGroupKey: string | null;
}) {
  const activeDestination = filesDestinationFromGroup(props.activeGroupKey);
  const active = activeDestination !== null;
  const [open, setOpen] = useNavigatorDisclosureState(props.accountId, "files", active);
  const wasActiveRef = useRef(active);

  useEffect(() => {
    const becameActive = active && !wasActiveRef.current;
    wasActiveRef.current = active;
    if (becameActive) setOpen(true);
  }, [active, setOpen]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="grid gap-1"
      data-files-disclosure="true"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "misty-navigator-row-target group/toggle flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-cream-muted outline-none transition-colors",
            "hover:bg-charcoal-card hover:text-cream-bright",
            navigatorFocusRingClass,
          )}
          aria-label="Files"
          data-navigator-disclosure-trigger="true"
          title={open ? "Collapse Files" : "Expand Files"}
        >
          <span className="grid size-7 shrink-0 place-items-center">
            <WorkspaceAppIcon appId="files" size="nav" />
          </span>
          <span className={navigationDisclosureLabelClass}>
            <span className="min-w-0 truncate">Files</span>
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
        <div className={navigationTreeGroupClass} role="group" aria-label="Files destinations">
          {destinations.map(({ id, label, icon: Icon, path }, index) => {
            const selected = id === activeDestination;
            return (
              <Link
                key={id}
                to={path}
                onClick={() => openWorkspaceRoute(path)}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  navigationTreeRowClass,
                  "misty-navigator-row-target rounded-md text-cream-muted no-underline outline-none transition-colors hover:text-cream-bright",
                  navigatorFocusRingClass,
                  selected && "text-cream-bright",
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
                    selected && "bg-charcoal-card/80",
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

function filesDestinationFromGroup(groupKey: string | null): FilesDestinationId | null {
  if (groupKey === "tool:files") return "explorer";
  if (groupKey === "tool:transfers") return "transfers";
  return null;
}

function openWorkspaceRoute(path: string) {
  const surface = workspaceSurfaceFromRoute(path);
  if (surface) useWorkspaceStore.getState().openSurface(surface);
}
