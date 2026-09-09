import { useNavigatorResume } from "./useNavigatorResume";
import { Renameable } from "@/features/navigation-names/Renameable";
import {
  useNavigationNames,
  navigationName,
  sectionNameKey,
  itemNameKey,
} from "@/features/navigation-names/store";
import { officialAppRoute } from "@/features/apps";
import {
  useWorkspaceStore,
  WorkspaceAppIcon,
  workspaceSurfaceFromRoute,
} from "@/features/workspace";
import {
  Collapsible,
  CollapsibleContent,
  NavigationSectionButton,
  NavigationTreeItem,
  navigationMenuGroupClass,
} from "@/shared/ui";
import { useEffect, useId, useRef } from "react";
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
  useNavigationNames();
  const sectionLabel = navigationName(sectionNameKey("files"), "Files");
  const [open, setOpen] = useNavigatorDisclosureState(props.accountId, "files", active);
  const wasActiveRef = useRef(active);

  useEffect(() => {
    const becameActive = active && !wasActiveRef.current;
    wasActiveRef.current = active;
    if (becameActive) setOpen(true);
  }, [active, setOpen]);

  const contentId = useId();
  const resume = useNavigatorResume({
    accountId: props.accountId,
    key: "files",
    fallbackRoute: officialAppRoute("files"),
  });
  const activate = () => {
    if (active && open) setOpen(false);
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
      data-files-disclosure="true"
    >
      <Renameable nameKey={sectionNameKey("files")} automatic={"Files"}>
        <NavigationSectionButton
          icon={<WorkspaceAppIcon appId={"files"} size="nav" />}
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
        <div className={navigationMenuGroupClass} role="group" aria-label="Files destinations">
          {destinations.map(({ id, label, icon: Icon, path }, index) => {
            const selected = id === activeDestination;
            return (
              <Renameable key={id} nameKey={itemNameKey("files", [id])} automatic={label}>
                <NavigationTreeItem
                  asChild
                  icon={<Icon aria-hidden />}
                  label={navigationName(itemNameKey("files", [id]), label)}
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
              </Renameable>
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
