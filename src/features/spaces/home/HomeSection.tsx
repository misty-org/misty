import type { ReactNode } from "react";
import { cn, Surface, Text } from "@/shared/ui";
import { homeSectionClass } from "./homeLayout";

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
    <header className="flex min-h-8 items-center justify-between gap-3">
      <Text
        as="h2"
        bare
        size="meta"
        tone="default"
        weight="semibold"
        className="m-0 flex items-center gap-2"
      >
        {props.attention && <OverviewDot status="needs-you" />}
        {props.title}
        {props.count ? (
          <Text bare tone="muted" weight="regular" className="tabular-nums">
            {props.count}
          </Text>
        ) : null}
      </Text>
      {props.action ? (
        <Text as="div" bare tone="muted" className="-mr-1.5 flex items-center gap-1">
          {props.action}
        </Text>
      ) : null}
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
    <section aria-label={props.title} className={cn(homeSectionClass, className)}>
      <HomeSectionHead {...head} />
      {children}
    </section>
  );
}

/**
 * A chat's or run's state as a small dot in its color: blue and breathing while it works, amber
 * while it waits on the person, red when it failed.
 */
export function OverviewDot({ status }: { status: string | undefined }) {
  const tone =
    status === "working"
      ? "working"
      : status === "needs-you"
        ? "waiting"
        : status === "failed"
          ? "failed"
          : undefined;
  return (
    <Text bare tone={tone} className="inline-flex shrink-0">
      <Surface
        as="span"
        tone="none"
        radius="full"
        className={cn(
          "size-1.5 shrink-0 bg-current",
          status === "working" &&
            "animate-[misty-breathe_1.6s_ease-in-out_infinite] motion-reduce:animate-none",
        )}
      />
    </Text>
  );
}
