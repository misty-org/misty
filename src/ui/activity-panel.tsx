import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/ui";

/**
 * Activity popup panel primitives built on the vega/zinc semantic tokens.
 *
 * These mirror the popover.tsx surface treatment (bg-popover/95, ring, blur)
 * so a floating activity feed sits on the same visual footing as the rest of
 * the shadcn surfaces and re-themes automatically. Positioning is left to the
 * caller (e.g. a portal + anchor); these only own the surface and layout.
 */
function ActivityPanel({ className, role = "dialog", ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="activity-panel"
      role={role}
      className={cn(
        [
          "grid h-[min(460px,calc(100vh-24px))] w-[420px] min-h-0",
          "grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-border",
          "bg-popover/95 text-popover-foreground shadow-[0_24px_64px_var(--misty-shadow)]",
          "ring-1 ring-foreground/10 backdrop-blur-xl",
        ].join(" "),
        className,
      )}
      {...props}
    />
  );
}

function ActivityPanelHeader({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header
      data-slot="activity-panel-header"
      className={cn(
        "flex items-center justify-between gap-3.5 border-b border-border p-4",
        className,
      )}
      {...props}
    />
  );
}

function ActivityPanelTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="activity-panel-title"
      className={cn("m-0 text-lg font-semibold leading-tight text-foreground", className)}
      {...props}
    />
  );
}

function ActivityPanelHeaderAction({
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      data-slot="activity-panel-header-action"
      type={type}
      className={cn(
        [
          "grid size-9 place-items-center rounded-lg border border-border bg-secondary p-0",
          "text-foreground transition hover:bg-accent focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
        ].join(" "),
        className,
      )}
      {...props}
    />
  );
}

function ActivityPanelTabs({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="activity-panel-tabs"
      role="tablist"
      className={cn("grid auto-cols-fr grid-flow-col border-b border-border px-4", className)}
      {...props}
    />
  );
}

function ActivityPanelTab({
  className,
  active = false,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      data-slot="activity-panel-tab"
      data-active={active || undefined}
      role="tab"
      aria-selected={active}
      type={type}
      className={cn(
        "relative flex h-10 items-center justify-center gap-1.5 border-0 bg-transparent text-xs font-semibold capitalize transition-colors",
        active
          ? "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function ActivityPanelTabBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="activity-panel-tab-badge"
      className={cn(
        "rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function ActivityPanelBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="activity-panel-body"
      className={cn("min-h-0 overflow-auto px-4 py-3", className)}
      {...props}
    />
  );
}

function ActivityPanelSectionLabel({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="activity-panel-section-label"
      className={cn(
        "mb-1 mt-0 px-2 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground [&:not(:first-child)]:mt-4",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A single activity row. Pass `asChild` to render as a button/link, and
 * `unread` to apply the subtle unread wash.
 */
function ActivityEntry({
  className,
  asChild = false,
  unread = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean; unread?: boolean }) {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      data-slot="activity-entry"
      data-unread={unread || undefined}
      className={cn(
        "relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-md px-2.5 py-[9px] text-left [&+&]:mt-1",
        unread && "bg-foreground/[0.035]",
        className,
      )}
      {...props}
    />
  );
}

function ActivityPanelEmpty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="activity-panel-empty"
      className={cn(
        "grid content-center justify-items-center gap-2 px-6 text-center text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function ActivityPanelEmptyTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="activity-panel-empty-title"
      className={cn("m-0 text-lg font-semibold leading-tight text-foreground", className)}
      {...props}
    />
  );
}

function ActivityPanelEmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="activity-panel-empty-description"
      className={cn("mt-1.5 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  ActivityPanel,
  ActivityPanelHeader,
  ActivityPanelTitle,
  ActivityPanelHeaderAction,
  ActivityPanelTabs,
  ActivityPanelTab,
  ActivityPanelTabBadge,
  ActivityPanelBody,
  ActivityPanelSectionLabel,
  ActivityEntry,
  ActivityPanelEmpty,
  ActivityPanelEmptyTitle,
  ActivityPanelEmptyDescription,
};
