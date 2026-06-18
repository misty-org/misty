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

export function Panel(props: PanelProps) {
  const Component = props.as ?? "section";
  return <Component className={`panel${props.className ? ` ${props.className}` : ""}`}>{props.children}</Component>;
}

export function PanelHeader(props: PanelHeaderProps) {
  return (
    <div className="panel-header">
      <div>
        <h2>{props.title}</h2>
        {props.subtitle ? <p>{props.subtitle}</p> : null}
      </div>
      {props.actions}
    </div>
  );
}
