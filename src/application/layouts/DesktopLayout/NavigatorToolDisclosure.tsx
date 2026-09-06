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
  NavigationSectionButton,
  NavigationTreeItem,
  navigationMenuGroupClass,
} from "@/shared/ui";
import { type LucideIcon } from "lucide-react";
import { useEffect, useRef, type ComponentType } from "react";
import { Link } from "react-router-dom";

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
      className={`${navigationMenuGroupClass} w-full min-w-0`}
      data-navigator-disclosure={props.appId}
    >
      <CollapsibleTrigger asChild>
        <NavigationSectionButton
          icon={<WorkspaceAppIcon appId={props.appId} size="nav" />}
          label={props.label}
          open={open}
          aria-label={props.label}
          data-navigator-disclosure-trigger="true"
          title={`${open ? "Collapse" : "Expand"} ${props.label}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          className={navigationMenuGroupClass}
          role="group"
          aria-label={`${props.label} destinations`}
        >
          {props.destinations.map(({ id, label, icon: Icon, path, onSelect }, index) => {
            const selected = id === props.activeDestination;
            return (
              <NavigationTreeItem
                key={id}
                asChild
                icon={<Icon aria-hidden />}
                label={label}
                selected={selected}
                last={index === props.destinations.length - 1}
              >
                <Link
                  to={path}
                  onClick={() => {
                    onSelect?.();
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

function openWorkspaceRoute(path: string) {
  const surface = workspaceSurfaceFromRoute(path);
  if (surface) useWorkspaceStore.getState().openSurface(surface);
}
