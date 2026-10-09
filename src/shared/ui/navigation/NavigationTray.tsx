import { Slot } from "@radix-ui/react-slot";
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { Pressable } from "../controls/Pressable";
import { TooltipHint, TooltipProvider } from "../overlays/Tooltip";
import { cn } from "../utils";
import { navigationMenuPrimaryLayoutClass } from "./NavigationMenu";

/** Shared global-rail disclosure, including inset, animation and collapsed accessibility. */
export function NavigationTray({
  id,
  label,
  groupLabel,
  icon,
  active,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  groupLabel: string;
  icon: ReactNode;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div
      data-navigator-tray="true"
      className={cn("grid min-w-0 rounded-lg", (open || active) && "bg-charcoal-hover")}
    >
      <TooltipHint content={`${open ? "Hide" : "Show"} ${label}`}>
        {/* The open tray is the toggle's highlight, so the toggle itself never fills. */}
        <Pressable
          className={cn(
            navigationMenuPrimaryLayoutClass,
            "box-border h-[var(--navigation-row-height,32px)] w-full min-w-0 rounded-md border-0 bg-transparent px-2.5",
            "text-[length:var(--navigation-row-font-size,13px)] font-medium text-cream-muted transition-none",
            "outline-none focus-visible:ring-2 focus-visible:ring-cream-muted",
            (open || active) && "text-cream-bright",
          )}
          aria-label={label}
          aria-expanded={open}
          aria-controls={id}
          data-active={active ? "true" : undefined}
          data-navigator-toggle="true"
          data-reorder-handle="true"
          data-reorder-header="true"
          onClick={onToggle}
        >
          {icon}
          <span>{label}</span>
        </Pressable>
      </TooltipHint>
      <div
        id={id}
        data-navigator-stack="true"
        data-open={open ? "true" : "false"}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <TooltipProvider delayDuration={350}>
          <div
            className="flex min-h-0 items-center gap-1.5 overflow-hidden"
            aria-label={groupLabel}
            role="group"
          >
            {children}
          </div>
        </TooltipProvider>
      </div>
    </div>
  );
}

/** One square tile for Space avatars and actions. Tiles carry their own surface, so
 * they never add a hover or selected fill (that read as a second container). */
export const NavigationTrayItem = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <Slot
      ref={ref}
      className={cn(
        "misty-navigator-tray-item relative cursor-pointer p-0 text-cream-muted outline-none focus-visible:ring-2 focus-visible:ring-cream/15",
        className,
      )}
      {...props}
    />
  ),
);
NavigationTrayItem.displayName = "NavigationTrayItem";
