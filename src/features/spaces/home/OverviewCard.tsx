import type { ReactNode } from "react";
import { Pressable, Skeleton } from "@/shared/ui";
import { HomeSection } from "./HomeSection";
import "./spaceOverview.css";

/** One block of the Space overview: the shared heading, then its rows on a panel. */
export function OverviewCard(props: {
  title: string;
  /** How many things the card holds, shown quietly after the heading. */
  count?: number;
  action?: ReactNode;
  tone?: "attention";
  children: ReactNode;
}) {
  return (
    <HomeSection
      title={props.title}
      count={props.count}
      attention={props.tone === "attention"}
      action={props.action}
      className="overview-card"
    >
      <div className="overview-panel" data-tone={props.tone}>
        {props.children}
      </div>
    </HomeSection>
  );
}

/** What an empty panel says, on one quiet line. */
export function OverviewEmpty({ children }: { children: ReactNode }) {
  return <p className="overview-card-empty">{children}</p>;
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

/** A chat's or run's state as a colored dot, its word only for screen readers and the tooltip. */
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
    <span
      className="overview-status"
      data-status={status}
      role="img"
      aria-label={word}
      title={word}
    >
      <span className="overview-dot" data-status={status} />
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
