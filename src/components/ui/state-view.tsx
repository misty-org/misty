import * as React from "react";
import { CircleAlert, Inbox, ShieldAlert } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type StateViewProps = Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
};

type StateTone = "empty" | "error" | "permission" | "loading";

const toneClasses: Record<StateTone, string> = {
  empty: "bg-muted text-muted-foreground",
  error: "bg-destructive/10 text-destructive",
  permission: "bg-amber-500/10 text-amber-500",
  loading: "bg-muted text-muted-foreground",
};

function StateView({
  action,
  className,
  compact = false,
  description,
  icon,
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
      <div
        className={cn(
          "mb-4 flex size-10 items-center justify-center rounded-lg [&>svg]:size-5",
          compact && "mb-3 size-9",
          toneClasses[tone],
        )}
      >
        {icon}
      </div>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm leading-5 text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-5 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

function EmptyState({ icon = <Inbox />, ...props }: StateViewProps) {
  return <StateView icon={icon} tone="empty" {...props} />;
}

function ErrorState({ icon = <CircleAlert />, ...props }: StateViewProps) {
  return <StateView icon={icon} role="alert" tone="error" {...props} />;
}

function PermissionState({ icon = <ShieldAlert />, ...props }: StateViewProps) {
  return <StateView icon={icon} tone="permission" {...props} />;
}

type LoadingStateProps = Omit<StateViewProps, "icon" | "title"> & {
  title?: React.ReactNode;
  label?: string;
};

function LoadingState({ label = "Loading", title = "Loading", ...props }: LoadingStateProps) {
  return (
    <StateView
      aria-live="polite"
      icon={<Spinner label={label} size="lg" />}
      title={title}
      tone="loading"
      {...props}
    />
  );
}

export {
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionState,
  type LoadingStateProps,
  type StateViewProps,
};
