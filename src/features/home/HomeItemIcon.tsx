import { SpaceAvatar, useSpacesStore } from "@/features/spaces";
import { isWorkspaceToolId, WorkspaceAppIcon, useWorkspaceStore } from "@/features/workspace";
import { cn } from "@/shared/ui";
import { useState } from "react";
import type { ContinueItem } from "./useContinueItems";

/** A tab's identity: the site's favicon, the Space's avatar, or the app's icon. */
export function HomeItemIcon(props: { item: ContinueItem; size: "md" | "lg" }) {
  const space = useSpacesStore((state) =>
    props.item.spaceId ? state.spaces.find((s) => s.id === props.item.spaceId) : undefined,
  );
  const [faviconFailed, setFaviconFailed] = useState(false);
  const box = props.size === "lg" ? "size-14" : "size-9";
  if (space) return <SpaceAvatar space={space} className={box} />;
  if (props.item.faviconUrl && !faviconFailed) {
    return (
      <span className={cn("grid shrink-0 place-items-center", box)}>
        <img
          src={props.item.faviconUrl}
          alt=""
          className={props.size === "lg" ? "size-10 rounded-lg" : "size-6 rounded-md"}
          onError={() => setFaviconFailed(true)}
        />
      </span>
    );
  }
  const { tab } = props.item;
  const spaceTool = tab.instanceKey.split(":").pop() ?? "";
  const appId =
    tab.surfaceId === "space" && isWorkspaceToolId(spaceTool)
      ? spaceTool
      : isWorkspaceToolId(tab.surfaceId)
        ? tab.surfaceId
        : "browser";
  return (
    <span className={cn("grid shrink-0 place-items-center", box)}>
      <WorkspaceAppIcon appId={appId} size={props.size === "lg" ? "marketplace" : "nav"} />
    </span>
  );
}

/** Brings a tab forward in whichever window holds it, then shows its route. */
export function resumeTab(item: ContinueItem) {
  if (!useWorkspaceStore.getState().focusTab(item.tab.id)) return;
  // The shell mirrors the selected tab. Home's scoped router must not navigate Home itself.
  window.dispatchEvent(new Event("misty:workspace-projection-applied"));
}
