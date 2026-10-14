import type { ReactNode } from "react";

export function standaloneWorkspaceRouteTitle(pathname: string): string | null {
  if (import.meta.env.DEV && pathname === "/dev/ui") return "UI gallery";
  if (pathname.startsWith("/invite/")) return "Space invitation";
  return null;
}

export function StandaloneRouteSurface(props: { title: string; children: ReactNode }) {
  return (
    <section className="grid h-full min-h-0 grid-rows-[38px_minmax(0,1fr)] overflow-hidden bg-charcoal-bg">
      <header
        data-window-toolbar
        className="flex h-[38px] items-center border-b border-charcoal-border bg-charcoal-workspace px-3"
      >
        <span className="text-sm font-medium text-cream-bright">{props.title}</span>
      </header>
      <div className="min-h-0 overflow-auto">{props.children}</div>
    </section>
  );
}
