import { cn, Surface, Text, windowToolbarClass } from "@/shared/ui";
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
      className="grid h-full min-h-0 grid-rows-[38px_minmax(0,1fr)] overflow-hidden"
    >
      <Surface
        as="header"
        tone="workspace"
        data-window-toolbar
        className={cn(windowToolbarClass, "flex h-10 items-center border-b px-3")}
      >
        <Text bare tone="bright" className="text-sm font-medium">
          {props.title}
        </Text>
      </Surface>
      <div className="min-h-0 overflow-auto">{props.children}</div>
    </Surface>
  );
}
