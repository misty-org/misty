import * as React from "react"

import { cn } from "@/lib/utils"

type PageShellProps = React.HTMLAttributes<HTMLDivElement> & {
  density?: "default" | "compact"
  surface?: "default" | "transparent"
}

const PageShell = React.forwardRef<HTMLDivElement, PageShellProps>(
  (
    {
      className,
      density = "default",
      surface = "default",
      ...props
    },
    ref,
  ) => (
    <div
      ref={ref}
      data-slot="page-shell"
      data-density={density}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden text-foreground",
        surface === "default" ? "bg-background" : "bg-transparent",
        className,
      )}
      {...props}
    />
  ),
)
PageShell.displayName = "PageShell"

type PageHeaderProps = Omit<React.HTMLAttributes<HTMLElement>, "title"> & {
  title: React.ReactNode
  description?: React.ReactNode
  eyebrow?: React.ReactNode
  leading?: React.ReactNode
  actions?: React.ReactNode
  tabs?: React.ReactNode
}

const PageHeader = React.forwardRef<HTMLElement, PageHeaderProps>(
  (
    {
      actions,
      className,
      description,
      eyebrow,
      leading,
      tabs,
      title,
      ...props
    },
    ref,
  ) => (
    <header
      ref={ref}
      data-slot="page-header"
      className={cn("shrink-0 border-b border-border/60 bg-background", className)}
      {...props}
    >
      <div className="flex min-h-14 min-w-0 items-center gap-3 px-6 py-2 [[data-density=compact]_&]:min-h-12 [[data-density=compact]_&]:px-4 max-[720px]:px-4">
        {leading ? (
          <div className="flex shrink-0 items-center text-muted-foreground">
            {leading}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <div className="mb-0.5 truncate text-[11px] font-medium text-muted-foreground">
              {eyebrow}
            </div>
          ) : null}
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="min-w-0 truncate text-base font-semibold leading-6 tracking-[-0.01em] text-foreground">
              {title}
            </h1>
            {description ? (
              <p className="min-w-0 truncate text-xs text-muted-foreground max-[760px]:hidden">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center justify-end gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {tabs ? <div className="px-6 [[data-density=compact]_&]:px-4 max-[720px]:px-4">{tabs}</div> : null}
    </header>
  ),
)
PageHeader.displayName = "PageHeader"

type PageBodyProps = React.HTMLAttributes<HTMLDivElement> & {
  scrollable?: boolean
  width?: "full" | "content"
}

const PageBody = React.forwardRef<HTMLDivElement, PageBodyProps>(
  ({ className, scrollable = true, width = "full", ...props }, ref) => (
    <div
      ref={ref}
      data-slot="page-body"
      className={cn(
        "min-h-0 min-w-0 flex-1 p-6 [[data-density=compact]_&]:p-4 max-[720px]:p-4",
        scrollable ? "overflow-y-auto overscroll-contain" : "overflow-hidden",
        width === "content" && "mx-auto w-full max-w-5xl",
        className,
      )}
      {...props}
    />
  ),
)
PageBody.displayName = "PageBody"

export {
  PageBody,
  PageHeader,
  PageShell,
  type PageBodyProps,
  type PageHeaderProps,
  type PageShellProps,
}
