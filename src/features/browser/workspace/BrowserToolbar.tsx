import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/shared/ui";
import { browserToolbarStyles } from "./browserToolbarStyles";

/**
 * The one toolbar every page shows with horizontal tabs: navigation buttons, badges, the
 * address field and the tool buttons, with the bar's height, border and surface fixed here.
 * A browser page fills each slot from its live tab; a page that isn't a browser page fills
 * them with their resting forms (see PaneToolbarFallback), so the two can't drift apart.
 */
export function BrowserToolbar({
  nav,
  badges,
  address,
  tools,
  className,
  style,
  ...rest
}: Omit<ComponentProps<"div">, "children"> & {
  nav: ReactNode;
  badges?: ReactNode;
  address: ReactNode;
  tools: ReactNode;
}) {
  return (
    <div
      className={cn(browserToolbarStyles.bar, "border-cream/[0.1]", className)}
      style={{ backgroundColor: "var(--workspace-tab-surface)", ...style }}
      data-window-toolbar
      data-browser-toolbar
      {...rest}
    >
      <div className={browserToolbarStyles.group}>{nav}</div>
      {badges}
      {address}
      <div className={browserToolbarStyles.group}>{tools}</div>
    </div>
  );
}
