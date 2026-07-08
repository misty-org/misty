import type { ReactNode } from "react";

interface PanelProps {
  as?: "aside" | "section" | "div";
  className?: string;
  children: ReactNode;
}

interface PanelHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

const panelBaseClass =
  "min-w-0 overflow-hidden rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-app-pane-bg,var(--misty-surface))] shadow-[0_18px_44px_var(--misty-shadow)]";

const panelHeaderClass =
  "flex items-center justify-between gap-4 border-b border-[var(--misty-border-soft)] px-[18px] py-4";

export function Panel(props: PanelProps) {
  const Component = props.as ?? "section";
  return <Component className={`${panelBaseClass}${props.className ? ` ${props.className}` : ""}`}>{props.children}</Component>;
}

export function PanelHeader(props: PanelHeaderProps) {
  return (
    <div className={panelHeaderClass}>
      <div>
        <h2>{props.title}</h2>
        {props.subtitle ? <p>{props.subtitle}</p> : null}
      </div>
      {props.actions}
    </div>
  );
}
