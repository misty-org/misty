import type { ComponentProps, ReactNode } from "react";
import { Button } from "../../controls/Button";
import { cn } from "../../utils";

/** Shared geometry for tool navigation and collection workspaces. */
export function WorkspaceSidebar({ className, ...props }: ComponentProps<"aside">) {
  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-56 shrink-0 flex-col gap-2 overflow-y-auto border-r",
        "border-charcoal-border bg-charcoal-sidebar p-2 misty-transient-scrollbar",
        className,
      )}
      {...props}
    />
  );
}

export function WorkspaceSidebarHeading({
  title,
  leading,
  actions,
  className,
}: {
  title: string;
  leading?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex min-h-9 shrink-0 items-center gap-2 px-2", className)}>
      {leading}
      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-cream-bright">{title}</h1>
      {actions}
    </header>
  );
}

export function WorkspaceSectionLabel({
  children,
  actions,
  compact = false,
  className,
}: {
  children: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-6 items-center justify-between gap-2 px-2",
        !compact && "mb-2 mt-4",
        className,
      )}
    >
      <h2 className="text-xs font-medium text-cream-muted">{children}</h2>
      {actions}
    </div>
  );
}

export function WorkspaceWelcome({
  icon,
  title,
  description,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto p-6 misty-transient-scrollbar">
      <section className="m-auto w-full max-w-184 py-12 text-center">
        <div className="mb-5 flex justify-center text-cream-muted">{icon}</div>
        <h1 className="flex min-h-9 items-center text-xl font-medium text-cream-bright">{title}</h1>
        {description && <p className="mt-2 text-sm text-cream-muted">{description}</p>}
        <div className="mt-10 grid grid-cols-2 gap-5">{children}</div>
        {action && <div className="mt-6">{action}</div>}
      </section>
    </div>
  );
}

export function WorkspaceSuggestion({
  icon,
  title,
  children,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="none"
      justify="start"
      aria-label={title}
      className="min-h-28 gap-4 whitespace-normal rounded-2xl border-dashed p-5 text-left"
      onClick={onClick}
    >
      <span className="text-cream-muted [&_svg]:!size-5">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-1 block text-sm font-normal leading-relaxed text-cream-muted">
          {children}
        </span>
      </span>
    </Button>
  );
}
