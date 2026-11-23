import { PageHeader, Surface, windowToolbarClass } from "@misty/ui";
import type { ReactNode } from "react";

export function standaloneWorkspaceRouteTitle(pathname: string): string | null {
  if (import.meta.env.DEV && pathname === "/dev/ui") return "UI gallery";
  if (pathname.startsWith("/invite/")) return "Space invitation";
  return null;
}

export function StandaloneRouteSurface(props: { title: string; children: ReactNode }) {
  return (
    <Surface
      as="section"
      tone="page"
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
    >
      <Surface tone="workspace" data-window-toolbar className={windowToolbarClass}>
        <PageHeader title={props.title} />
      </Surface>
      <div className="min-h-0 overflow-auto">{props.children}</div>
    </Surface>
  );
}
