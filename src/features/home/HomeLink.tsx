import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import type { ComponentProps, MouseEvent } from "react";
import { Link } from "react-router-dom";

/** A link that opens its route as a workspace tab, the way the navigator does. */
export function HomeLink(props: ComponentProps<typeof Link>) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    props.onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const path = typeof props.to === "string" ? props.to : (props.to.pathname ?? "");
    const surface = workspaceSurfaceFromRoute(path);
    if (surface) useWorkspaceStore.getState().openSurface(surface);
  };
  return <Link {...props} onClick={handleClick} />;
}
