import {
  useWorkspaceStore,
  WorkspaceAppIcon,
  workspaceSurfaceFromRoute,
  type NavigatorAppId,
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
import { ChevronRight, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type ComponentType } from "react";
import { Link } from "react-router-dom";
import {
  navigatorFocusRingClass,
  navigatorPrimaryRowLayoutClass,
  navigatorSubsectionIconClass,
} from "./styles";
import { useNavigatorDisclosureState } from "./useNavigatorDisclosureState";

type DestinationIcon = LucideIcon | ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

export interface NavigatorToolDestination {
  id: string;
  label: string;
  icon: DestinationIcon;
  path: string;
  onSelect?: () => void;
}

export function NavigatorToolDisclosure(props: {
  accountId: string;
  appId: NavigatorAppId;
  label: string;
  path: string;
  active: boolean;
  activeDestination: string | null;
  destinations: NavigatorToolDestination[];
}) {
  const [open, setOpen] = useNavigatorDisclosureState(props.accountId, props.appId, props.active);
  const wasActiveRef = useRef(props.active);

  useEffect(() => {
    const becameActive = props.active && !wasActiveRef.current;
    wasActiveRef.current = props.active;
    if (becameActive) setOpen(true);
  }, [props.active, setOpen]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="grid w-full min-w-0 gap-1"
      data-navigator-disclosure={props.appId}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "misty-navigator-row-target group/toggle box-border h-9 w-full rounded-md px-2.5 text-left text-sm text-cream-muted outline-none transition-colors",
            navigatorPrimaryRowLayoutClass,
            "hover:bg-charcoal-card hover:text-cream-bright",
            navigatorFocusRingClass,
          )}
          aria-label={props.label}
          data-navigator-disclosure-trigger="true"
          title={open ? `Collapse ${props.label}` : `Expand ${props.label}`}
        >
          <span className="grid size-7 shrink-0 place-items-center">
            <WorkspaceAppIcon appId={props.appId} size="nav" />
          </span>
          <span className={navigationDisclosureLabelClass}>
            <span className="min-w-0 truncate">{props.label}</span>
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
        <div
          className={navigationTreeGroupClass}
          role="group"
          aria-label={`${props.label} destinations`}
        >
          {props.destinations.map(({ id, label, icon: Icon, path, onSelect }, index) => {
            const selected = id === props.activeDestination;
            return (
              <Link
                key={id}
                to={path}
                onClick={() => {
                  onSelect?.();
                  openWorkspaceRoute(path);
                }}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  navigationTreeRowClass,
                  "misty-navigator-row-target text-cream-muted no-underline outline-none transition-colors hover:text-cream-bright",
                  navigatorFocusRingClass,
                  selected && "text-cream-bright",
                )}
              >
                <TreeBranch
                  className={navigationTreeBranchClass}
                  first={index === 0}
                  last={index === props.destinations.length - 1}
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
                    <Icon className={navigationTreeItemIconClass} aria-hidden />
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

function openWorkspaceRoute(path: string) {
  const surface = workspaceSurfaceFromRoute(path);
  if (surface) useWorkspaceStore.getState().openSurface(surface);
}
