import type { StateViewProps, StateTone, LoadingStateProps } from "@/models/types/ui/state-view";
export type { StateViewProps, StateTone, LoadingStateProps } from "@/models/types/ui/state-view";
import * as React from "react";

import { Spinner } from "@/ui";
import { cn } from "@/ui";

const toneClasses: Record<StateTone, string> = {
  empty: "text-foreground",
  error: "text-destructive",
  permission: "text-amber-500",
  loading: "text-foreground",
};

/**
 * Empty, error, and permission states are text only.
 *
 * These used to lead with a tinted icon tile above the heading. It carried no
 * information the heading did not already state, and it pushed the actual
 * message down the page, so it was removed everywhere rather than per screen.
 */
function StateView({
  action,
  className,
  compact = false,
  description,
  title,
  tone,
  ...props
}: StateViewProps & { tone: StateTone }) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-md flex-col items-center justify-center px-6 py-12 text-center",
        compact && "max-w-sm px-4 py-6",
        className,
      )}
      {...props}
    >
      <h2 className={cn("text-sm font-semibold", toneClasses[tone])}>{title}</h2>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm leading-5 text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-5 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

function EmptyState(props: StateViewProps) {
  return <StateView tone="empty" {...props} />;
}

function ErrorState(props: StateViewProps) {
  return <StateView role="alert" tone="error" {...props} />;
}

function PermissionState(props: StateViewProps) {
  return <StateView tone="permission" {...props} />;
}

/**
 * Loading keeps its spinner, inline with the label.
 *
 * Unlike the icons removed above, a spinner is not decoration: it is the only
 * signal that work is still in progress. It sits beside the text rather than
 * stacked above it.
 */
function LoadingState({ label = "Loading", title = "Loading", ...props }: LoadingStateProps) {
  return (
    <StateView
      aria-live="polite"
      title={
        <span className="inline-flex items-center gap-2">
          <Spinner label={label} size="sm" />
          {title}
        </span>
      }
      tone="loading"
      {...props}
    />
  );
}
export { EmptyState, ErrorState, LoadingState, PermissionState };
