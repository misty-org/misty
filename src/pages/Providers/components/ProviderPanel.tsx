import type {
  PanelProps,
  PanelHeaderProps,
} from "@/models/interfaces/pages/Providers/components/ProviderPanel";
export type {
  PanelProps,
  PanelHeaderProps,
} from "@/models/interfaces/pages/Providers/components/ProviderPanel";
import type { ReactNode } from "react";
import { Card, CardHeader } from "@/ui";
import { cn } from "@/ui";

export function Panel(props: PanelProps) {
  const Component = props.as ?? "section";
  return (
    <Component className="contents">
      <Card
        className={cn(
          "min-w-0 overflow-hidden border-border bg-card text-card-foreground shadow-sm",
          props.className,
        )}
      >
        {props.children}
      </Card>
    </Component>
  );
}

export function PanelHeader(props: PanelHeaderProps) {
  return (
    <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-border px-[18px] py-3.5">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-foreground">{props.title}</h2>
        {props.subtitle ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{props.subtitle}</p>
        ) : null}
      </div>
      {props.actions}
    </CardHeader>
  );
}
