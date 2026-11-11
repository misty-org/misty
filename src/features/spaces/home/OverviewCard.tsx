import type { ReactNode } from "react";
import { Pressable, Skeleton } from "@/shared/ui";
import "./spaceOverview.css";

/** One card of the Space overview: a heading, an optional action beside it, then its rows. */
export function OverviewCard(props: {
  title: string;
  /** How many things the card holds, shown quietly after the heading. */
  count?: number;
  action?: ReactNode;
  tone?: "attention";
  children: ReactNode;
}) {
  return (
    <section className="overview-card" aria-label={props.title} data-tone={props.tone}>
      <header className="overview-card-head">
        <h2 className="overview-card-title">
          {props.tone === "attention" && <span className="overview-dot" data-status="needs-you" />}
          {props.title}
          {props.count ? <span className="overview-card-count">{props.count}</span> : null}
        </h2>
        {props.action}
      </header>
      {props.children}
    </section>
  );
}

/** A row that opens something: a mark, a title over one quiet line, and what belongs at the end. */
export function OverviewRow(props: {
  leading: ReactNode;
  /** A mark that is an icon sits on a small tile; an avatar stands alone. */
  kind?: "folder" | "schedule";
  title: string;
  detail?: ReactNode;
  trailing?: ReactNode;
  onOpen(): void;
}) {
  return (
    <Pressable className="overview-row" onClick={props.onOpen}>
      <span className="overview-row-mark" data-kind={props.kind}>
        {props.leading}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-sm text-cream">{props.title}</span>
        {props.detail ? <span className="overview-row-detail">{props.detail}</span> : null}
      </span>
      {props.trailing ? <span className="overview-row-end">{props.trailing}</span> : null}
    </Pressable>
  );
}

/** A chat's or run's state as a dot and a word; nothing for one that finished. */
export function OverviewStatus({ status }: { status: string | undefined }) {
  const word =
    status === "working"
      ? "Working"
      : status === "needs-you"
        ? "Needs you"
        : status === "failed"
          ? "Failed"
          : "";
  if (!word) return null;
  return (
    <span className="overview-status" data-status={status}>
      <span className="overview-dot" data-status={status} />
      {word}
    </span>
  );
}

const widths = ["w-3/5", "w-2/5", "w-1/2", "w-2/3", "w-1/3"];

/** Placeholder rows shaped like the rows that replace them. */
export function OverviewRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="overview-row">
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className={`h-3 ${widths[index % widths.length]}`} />
            <Skeleton className="h-2.5 w-24" />
          </div>
          <Skeleton className="h-2.5 w-6" />
        </div>
      ))}
    </div>
  );
}
