import * as React from "react"

import { Button, type ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type SidebarNavProps = React.HTMLAttributes<HTMLElement> & {
  label: string
}

const SidebarNav = React.forwardRef<HTMLElement, SidebarNavProps>(
  ({ className, label, ...props }, ref) => (
    <nav
      ref={ref}
      aria-label={label}
      data-slot="sidebar-nav"
      className={cn("flex min-h-0 flex-col gap-4", className)}
      {...props}
    />
  ),
)
SidebarNav.displayName = "SidebarNav"

type SidebarNavSectionProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "title"
> & {
  label?: React.ReactNode
}

const SidebarNavSection = React.forwardRef<
  HTMLDivElement,
  SidebarNavSectionProps
>(({ children, className, label, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="sidebar-nav-section"
    className={cn("grid gap-1", className)}
    {...props}
  >
    {label ? (
      <div className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">
        {label}
      </div>
    ) : null}
    {children}
  </div>
))
SidebarNavSection.displayName = "SidebarNavSection"

type SidebarNavItemProps = Omit<ButtonProps, "asChild" | "size" | "variant"> & {
  active?: boolean
  badge?: React.ReactNode
  compact?: boolean
  icon?: React.ReactNode
}

const SidebarNavItem = React.forwardRef<HTMLButtonElement, SidebarNavItemProps>(
  (
    {
      active = false,
      badge,
      children,
      className,
      compact = false,
      icon,
      type = "button",
      ...props
    },
    ref,
  ) => (
    <Button
      ref={ref}
      type={type}
      variant="ghost"
      size="sm"
      aria-current={active ? "page" : undefined}
      data-active={active || undefined}
      className={cn(
        "group/nav-item h-9 w-full justify-start gap-2.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground",
        active &&
          "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        compact && "h-8 px-2 text-xs",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
      {badge ? <span className="ml-auto shrink-0">{badge}</span> : null}
    </Button>
  ),
)
SidebarNavItem.displayName = "SidebarNavItem"

export {
  SidebarNav,
  SidebarNavItem,
  SidebarNavSection,
  type SidebarNavItemProps,
  type SidebarNavProps,
  type SidebarNavSectionProps,
}
