import type { ReactNode } from "react";
import { cn } from "@/shared/ui";
import "./spaceOverview.css";

/**
 * The one heading every block on a Space's home wears: a title, a quiet count, an optional dot
 * when something waits for the person, and an action at the far end.
 */
export function HomeSectionHead(props: {
  title: string;
  count?: number;
  attention?: boolean;
  action?: ReactNode;
}) {
  return (
    <header className="home-section-head">
      <h2 className="home-section-title">
        {props.attention && <span className="overview-dot" data-status="needs-you" />}
        {props.title}
        {props.count ? <span className="home-section-count">{props.count}</span> : null}
      </h2>
      {props.action ? <div className="home-section-action">{props.action}</div> : null}
    </header>
  );
}

/** A block of a Space's home: its heading, then whatever it holds. */
export function HomeSection(props: {
  title: string;
  count?: number;
  attention?: boolean;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const { children, className, ...head } = props;
  return (
    <section aria-label={props.title} className={cn("home-section", className)}>
      <HomeSectionHead {...head} />
      {children}
    </section>
  );
}
