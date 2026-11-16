import type { ComponentPropsWithoutRef, ComponentType, ReactNode } from "react";
import { cn } from "../../classNames";
import { Pressable } from "../../controls/Pressable";
import { OverflowFadeText } from "../../layout/OverflowFadeText";
import { Surface } from "../../display/Surface";
import { Text } from "../../display/Text";
import { homeSectionClass } from "./homeLayout";

/**
 * The one heading every block on a Space's home wears: a title, its count, an optional dot
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
        {/* The count reads as part of the title: same size, weight and color. */}
        {props.count ? <span className="tabular-nums">{props.count}</span> : null}
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

/** The quiet neutral square a page tile's icon sits on. */
export function PlaceIconTile({ children }: { children?: ReactNode }) {
  return (
    <Surface
      as="span"
      tone="faint"
      radius="lg"
      aria-hidden
      className="grid size-7 shrink-0 place-items-center"
    >
      <Text bare tone="muted" className="contents">
        {children}
      </Text>
    </Surface>
  );
}

/**
 * A page or topic on a home, as a small chip: its icon, then its name, on a faint fill with no
 * edge, washing under the pointer. A row of them wraps (`homeChipsClass`), so the home reads as
 * a page rather than a grid of boxes. `pressed` marks the one picked, for chips that pick (the
 * Lab's topics); chips that open a page leave it out.
 */
export function PlaceChip({
  icon: Icon,
  label,
  pressed,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<"button">, "children"> & {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  pressed?: boolean;
}) {
  return (
    <Surface
      as={Pressable}
      tone="faint"
      radius="lg"
      wash="control"
      selected={pressed}
      aria-pressed={pressed}
      className={cn(
        "inline-flex h-8 max-w-full min-w-0 items-center gap-2 px-3 text-control",
        pressed ? "text-cream-bright" : "text-cream-muted",
        className,
      )}
      {...props}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <OverflowFadeText>{label}</OverflowFadeText>
    </Surface>
  );
}
