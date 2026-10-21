import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/shared/ui";
import { browserToolbarStyles } from "./browserToolbarStyles";

/**
 * A browser page's own toolbar, for when no tab sidebar holds it (focus mode): navigation
 * buttons, badges, the address field and the tool buttons, with the bar's height, border and
 * surface fixed here.
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
