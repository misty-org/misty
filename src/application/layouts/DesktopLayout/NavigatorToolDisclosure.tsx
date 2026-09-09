import { useNavigatorResume } from "./useNavigatorResume";
import { Renameable } from "@/features/navigation-names/Renameable";
import {
  useNavigationNames,
  navigationName,
  sectionNameKey,
  itemNameKey,
} from "@/features/navigation-names/store";
import {
  useWorkspaceStore,
  WorkspaceAppIcon,
  workspaceSurfaceFromRoute,
  type NavigatorAppId,
} from "@/features/workspace";
import {
  Collapsible,
  CollapsibleContent,
  NavigationSectionButton,
  NavigationTreeItem,
  navigationMenuGroupClass,
} from "@/shared/ui";
import { type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, type ComponentType } from "react";
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
  useNavigationNames();
  const sectionLabel = navigationName(sectionNameKey(props.appId), props.label);
  const [open, setOpen] = useNavigatorDisclosureState(props.accountId, props.appId, props.active);
  const wasActiveRef = useRef(props.active);

  useEffect(() => {
    const becameActive = props.active && !wasActiveRef.current;
    wasActiveRef.current = props.active;
    if (becameActive) setOpen(true);
  }, [props.active, setOpen]);

  const contentId = useId();
  const resume = useNavigatorResume({
    accountId: props.accountId,
    key: props.appId,
    fallbackRoute: props.path,
  });
  const activate = () => {
    if (props.active && open) setOpen(false);
    else {
      setOpen(true);
      resume();
    }
  };

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={`${navigationMenuGroupClass} w-full min-w-0`}
      data-navigator-disclosure={props.appId}
    >
      <Renameable nameKey={sectionNameKey(props.appId)} automatic={props.label}>
        <NavigationSectionButton
          icon={<WorkspaceAppIcon appId={props.appId} size="nav" />}
          label={sectionLabel}
          open={open}
          aria-controls={contentId}
          onClick={activate}
          aria-label={sectionLabel}
          data-navigator-disclosure-trigger="true"
          title={`${open ? "Collapse" : "Expand"} ${sectionLabel}`}
        />
      </Renameable>
      <CollapsibleContent id={contentId}>
        <div
          className={navigationMenuGroupClass}
          role="group"
          aria-label={`${sectionLabel} destinations`}
        >
          {props.destinations.map(({ id, label, icon: Icon, path, onSelect }, index) => {
            const selected = id === props.activeDestination;
            return (
              <Renameable key={id} nameKey={itemNameKey(props.appId, [id])} automatic={label}>
                <NavigationTreeItem
                  asChild
                  icon={<Icon aria-hidden />}
                  label={navigationName(itemNameKey(props.appId, [id]), label)}
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
              </Renameable>
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
