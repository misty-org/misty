import type { ReactNode } from "react";
import { Card, CardHeader, cn } from "@/ui";

export function Panel(props: PanelProps) {
  const Component = props.as ?? "section";
  return (
    <Component className="contents">
      <Card
        className={cn(
          "min-w-0 overflow-hidden border-charcoal-border bg-charcoal-card text-cream shadow-sm",
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
    <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-charcoal-border px-[18px] py-3.5">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-cream">{props.title}</h2>
        {props.subtitle ? (
          <p className="mt-0.5 truncate text-xs text-cream-muted">{props.subtitle}</p>
        ) : null}
      </div>
      {props.actions}
    </CardHeader>
  );
}

export interface PanelProps {
  as?: "aside" | "section" | "div";
  className?: string;
  children: ReactNode;
}

export interface PanelHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}
