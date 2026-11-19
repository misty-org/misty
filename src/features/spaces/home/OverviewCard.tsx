import type { ReactNode } from "react";
import { cn, Pressable, Skeleton, Surface, Text, Tooltip } from "@/shared/ui";
import { overviewRowClass } from "./homeLayout";
import { HomeSection, OverviewDot } from "./HomeSection";

/**
 * One block of the Space overview: the shared heading, then its rows, in a panel with a hairline
 * edge so each block reads as its own place on the home. Each row washes under the pointer; the
 * rows sit a step out to each side so their marks and titles line up with the heading above them.
 */
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
      panel
    >
      {/* Something waiting shows in the heading's dot, so every panel keeps the same edge. */}
      <div className="-mx-2 grid min-w-0 content-start has-[>[data-overview-empty]]:content-stretch">
        {props.children}
      </div>
    </HomeSection>
  );
}

/**
 * What an empty block says, on one quiet line in the middle of the room the block takes, so a
 * block beside a fuller one doesn't leave its words stranded at the top corner.
 */
export function OverviewEmpty({ children }: { children: ReactNode }) {
  return (
    <Text
      as="p"
      bare
      size="meta"
      tone="muted"
      data-overview-empty=""
      className="m-0 flex h-full min-h-24 items-center justify-center px-2 text-center"
    >
      {children}
    </Text>
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
    <Surface
      as={Pressable}
      tone="none"
      radius="md"
      wash="control"
      className={overviewRowClass}
      onClick={props.onOpen}
    >
      {props.kind ? (
        <Surface
          as="span"
          tone="faint"
          radius="lg"
          className="grid size-7 shrink-0 place-items-center"
        >
          <Text bare tone="muted" className="contents">
            {props.leading}
          </Text>
        </Surface>
      ) : (
        <span className="grid size-7 shrink-0 place-items-center">{props.leading}</span>
      )}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <Text full tone="default" className="text-sm">
          {props.title}
        </Text>
        {props.detail ? (
          <Text
            bare
            size="caption"
            tone="muted"
            className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap"
          >
            {props.detail}
          </Text>
        ) : null}
      </span>
      {props.trailing ? (
        <Text
          bare
          size="caption"
          tone="muted"
          className="flex shrink-0 items-center gap-2.5 tabular-nums"
        >
          {props.trailing}
        </Text>
      ) : null}
    </Surface>
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
    <Tooltip content={word}>
      <span className="inline-flex shrink-0 items-center gap-1.5" role="img" aria-label={word}>
        <OverviewDot status={status} />
      </span>
    </Tooltip>
  );
}

const widths = ["w-3/5", "w-2/5", "w-1/2", "w-2/3", "w-1/3"];

/**
 * Placeholder rows shaped like the `OverviewRow`s that replace them: the 28px mark (a round
 * avatar, or the tile a folder or schedule icon sits on), the title's line, the quiet line under
 * it when the rows have one, and what sits at the end, at its own width.
 */
export function OverviewRowsSkeleton({
  rows = 3,
  kind,
  detail = true,
  trailing = "w-6",
}: {
  rows?: number;
  /** The rows' `OverviewRow` kind: an icon on a tile, or an avatar when left out. */
  kind?: "folder" | "schedule";
  /** Whether each row has a quiet line under its title. */
  detail?: boolean;
  /** The width of what ends each row, or false when nothing does. */
  trailing?: string | false;
}) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={overviewRowClass}>
          <Skeleton className={cn("size-7 shrink-0", kind ? "rounded-lg" : "rounded-full")} />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <div className="flex h-5 items-center">
              <Skeleton className={cn("h-3.5", widths[index % widths.length])} />
            </div>
            {detail ? (
              <div className="flex h-4 items-center">
                <Skeleton className="h-2.5 w-24" />
              </div>
            ) : null}
          </div>
          {trailing ? <Skeleton className={cn("h-3 shrink-0", trailing)} /> : null}
        </div>
      ))}
    </div>
  );
}
