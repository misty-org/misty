import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";

import { cn } from "../../classNames";
import { Pressable } from "../../controls/Pressable";
import { Separator } from "../../layout/Separator";
import { OverflowFadeText } from "../../layout/OverflowFadeText";
import { Text } from "../../display/Text";

/*
 * A place where people talk, laid out as Discord lays it out: a column of channels on the
 * sidebar's fill, then the open channel on the card's fill, its header over the messages and,
 * beside them, the member list. Discord's lines too: one under both headers, one before the
 * member list. Sizes are Discord's, in design pixels a tenth under its CSS pixels, since the main
 * window's root is 110%: a 44px header, 32px channel rows, a 52px composer.
 */

/** The whole page: the channel column, then the open channel. */
export function ChannelPage({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex h-full min-h-0 min-w-0", className)} {...props} />;
}

/** The channel column, on the sidebar's fill: a header naming the place, then the list. */
export function ChannelSidebar(props: {
  header: ReactNode;
  children: ReactNode;
  "aria-label": string;
}) {
  return (
    <aside
      aria-label={props["aria-label"]}
      className="flex h-full min-h-0 w-60 shrink-0 flex-col bg-charcoal-sidebar"
    >
      {props.header}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-3 pb-2">
        {props.children}
      </div>
    </aside>
  );
}

/** Both headers' height and the line under them, so the two read as one bar across the page. */
const headerBar = "flex h-11 shrink-0 items-center border-b border-charcoal-border";

/**
 * The top of the channel column: the place's name with its chevron right after it, as Discord
 * draws it, the whole bar one button that opens its menu (`asChild` trigger).
 */
export function ChannelSidebarHeader({
  name,
  open,
  ...props
}: { name: string; open?: boolean } & Omit<ComponentProps<typeof Pressable>, "children">) {
  return (
    <Pressable
      type="button"
      wash="row"
      className={cn(headerBar, "w-full gap-1 px-4 text-left")}
      {...props}
    >
      <Text size="body" weight="semibold" tone="bright" className="min-w-0">
        {name}
      </Text>
      <Text bare tone="muted" className={cn("transition-transform", open && "rotate-180")}>
        <ChevronDown aria-hidden="true" />
      </Text>
    </Pressable>
  );
}

/**
 * The open channel on the card's fill: its header across the top, the chat, then `side` (the
 * member list, a thread, search results) after a line, on the same fill.
 */
export function ChannelMain(props: { header: ReactNode; side?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-charcoal-card">
      {props.header}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{props.children}</div>
        {props.side ? (
          <div className="flex min-h-0 shrink-0 border-l border-charcoal-border">{props.side}</div>
        ) : null}
      </div>
    </section>
  );
}

/** The channel's bar: its icon and name, an optional topic, and its controls at the end. */
export function ChannelHeader(props: {
  icon?: LucideIcon;
  /** A person's face for a direct message, in place of an icon. */
  leading?: ReactNode;
  name: string;
  topic?: string;
  end?: ReactNode;
}) {
  const Icon = props.icon;
  return (
    <header className={cn(headerBar, "gap-2 px-4")}>
      {props.leading ??
        (Icon ? (
          <Text bare tone="muted">
            <Icon aria-hidden="true" className="size-5" />
          </Text>
        ) : null)}
      <Text as="h1" size="body" weight="semibold" tone="bright" className="min-w-0 shrink-0">
        {props.name}
      </Text>
      {props.topic ? (
        <>
          <Separator orientation="vertical" className="mx-1 h-4" />
          <OverflowFadeText className="min-w-0 flex-1 text-meta text-cream-muted">
            {props.topic}
          </OverflowFadeText>
        </>
      ) : (
        <span className="flex-1" />
      )}
      {props.end ? <div className="flex shrink-0 items-center gap-2">{props.end}</div> : null}
    </header>
  );
}

/**
 * The top of a channel's history, once the very first message is in view: a large mark, a
 * welcome and where this channel begins.
 */
export function ChannelWelcome(props: {
  icon?: LucideIcon;
  /** A person's face for a direct message, in place of the icon. */
  mark?: ReactNode;
  title: string;
  line: string;
}) {
  const Icon = props.icon;
  return (
    <div className="flex flex-col items-start gap-1 pt-4 pb-4">
      {props.mark ?? (
        <span className="mb-2 flex size-16 items-center justify-center rounded-full bg-control-active text-cream-bright">
          {Icon ? <Icon aria-hidden="true" className="size-9" /> : null}
        </span>
      )}
      <Text as="h2" size="display" weight="semibold" tone="bright" wrap>
        {props.title}
      </Text>
      <Text as="p" size="body" tone="muted" wrap>
        {props.line}
      </Text>
    </div>
  );
}

/**
 * A line across the history with a label in it: a day (`date`), or where the messages the
 * person hasn't read begin (`new`), drawn in the danger color with a "New" tag at its end.
 */
export function ChannelDivider(props: { label?: string; kind?: "date" | "new" }) {
  const isNew = props.kind === "new";
  const line = cn("h-px flex-1", isNew ? "bg-danger/50" : "bg-charcoal-border");
  return (
    <div
      role="separator"
      aria-label={isNew ? `New messages${props.label ? `, ${props.label}` : ""}` : props.label}
      className="mt-6 mb-2 flex items-center gap-2 first:mt-0"
    >
      <span className={line} />
      {props.label ? (
        <Text bare size="caption" weight="semibold" tone={isNew ? "danger" : "muted"}>
          {props.label}
        </Text>
      ) : null}
      {props.label || !isNew ? <span className={line} /> : null}
      {isNew ? (
        <span className="rounded-sm bg-danger px-1 text-micro font-semibold text-white">New</span>
      ) : null}
    </div>
  );
}

/**
 * "X is typing…" in the strip under the composer, where Discord writes it: the strip is the
 * composer's bottom margin, so it keeps its height when empty.
 */
export function TypingLine(props: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex h-6 shrink-0 items-center gap-1.5 px-4">
      {props.label ? (
        <>
          <span aria-hidden="true" className="flex gap-0.5">
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="size-1 animate-[misty-dot-blink_1.1s_ease-in-out_infinite] rounded-full bg-cream-muted"
                style={{ animationDelay: `${dot * 160}ms` }}
              />
            ))}
          </span>
          <Text bare size="caption" tone="muted">
            {props.label}
          </Text>
        </>
      ) : null}
    </div>
  );
}

/**
 * The mark on a message that mentions the person reading it, by name or by a role they hold: a
 * thin bar down its left edge, in the waiting tone. The message is the positioning box.
 */
export function MentionMark() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-0 w-0.5 rounded-full bg-[var(--tone-waiting)]"
    />
  );
}
