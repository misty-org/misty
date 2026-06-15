import { officialAppRoute } from "@/features/apps";
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
import { ExplorerDestinationIcon, TransfersDestinationIcon } from "./NavigatorDestinationIcons";

import { useNavigatorDisclosureState } from "./useNavigatorDisclosureState";

type FilesDestinationId = "explorer" | "transfers";

const destinations = [
  {
    id: "explorer" as const,
    label: "Explorer",
    icon: ExplorerDestinationIcon,
    path: officialAppRoute("files"),
  },
  {
    id: "transfers" as const,
    label: "Transfers",
    icon: TransfersDestinationIcon,
    path: officialAppRoute("transfers"),
  },
];

export function FilesNavigatorDisclosure(props: {
  accountId: string;
  activeGroupKey: string | null;
  activeRoute?: string;
}) {
  const activeDestination = filesDestinationFromGroup(props.activeGroupKey, props.activeRoute);
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
      className={`${navigationMenuGroupClass} w-full min-w-0`}
      data-files-disclosure="true"
    >
      <CollapsibleTrigger asChild>
        <NavigationSectionButton
          icon={<WorkspaceAppIcon appId={"files"} size="nav" />}
          label={"Files"}
          open={open}
          aria-label={"Files"}
          data-navigator-disclosure-trigger="true"
          title={`${open ? "Collapse" : "Expand"} ${"Files"}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className={navigationMenuGroupClass} role="group" aria-label="Files destinations">
          {destinations.map(({ id, label, icon: Icon, path }, index) => {
            const selected = id === activeDestination;
            return (
              <NavigationTreeItem
                key={id}
                asChild
                icon={<Icon aria-hidden />}
                label={label}
                selected={selected}
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

function filesDestinationFromGroup(groupKey: string | null, route = ""): FilesDestinationId | null {
  if (groupKey === "app:files")
    return new URL(route, "https://misty.local").searchParams.get("view") === "transfers"
      ? "transfers"
      : "explorer";
  if (groupKey === "app:transfers") return "transfers";
  return null;
}

function openWorkspaceRoute(path: string) {
  const surface = workspaceSurfaceFromRoute(path);
  if (surface) useWorkspaceStore.getState().openSurface(surface);
}
