import { Check, Circle, CircleAlert, CircleMinus, CircleX, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn, Surface, Text, type TextTone } from "@/shared/ui";

/**
 * Every list of steps in a conversation (checklist, sub-agents, plan, requests,
 * unfinished work) is this one bordered table: a status icon and word, the thing
 * itself, a short result and its buttons. Color marks only "waiting for you"
 * (amber), "failed" (red) and "done"; the word always says it too.
 */
export type StatusState =
  "done" | "running" | "next" | "failed" | "waiting" | "stopped" | "skipped" | "plain";

const icons = {
  done: Check,
  running: LoaderCircle,
  next: Circle,
  failed: CircleX,
  waiting: CircleAlert,
  stopped: CircleAlert,
  skipped: CircleMinus,
} as const;

export function StatusTable({
  label,
  head,
  actions,
  children,
}: {
  label: string;
  /** A muted line over the rows, such as "Not finished" over its reasons. */
  head?: ReactNode;
  /** Buttons under the rows. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Surface
      as="section"
      tone="none"
      edge="hairline"
      radius="xl"
      className="mt-1.5 mb-2 overflow-hidden text-control leading-normal"
      aria-label={label}
    >
      {head ? (
        <Text as="div" bare size="caption" tone="muted" className="block border-b px-3.5 py-2">
          {head}
        </Text>
      ) : null}
      <ol className="m-0 list-none p-0 [&>li+li]:border-t">{children}</ol>
      {actions ? (
        <div className="flex flex-wrap gap-2 border-t px-3.5 py-2.5">{actions}</div>
      ) : null}
    </Surface>
  );
}

/** The icon's tone in each state; a state left out keeps the row's muted color. */
const iconTone: Partial<Record<StatusState, TextTone>> = {
  done: "done",
  failed: "failed",
  waiting: "waiting",
  stopped: "waiting",
};

/** The status word's tone, where the state means the person should look. */
const verbTone: Partial<Record<StatusState, TextTone>> = {
  waiting: "waiting",
  stopped: "waiting",
};

/** The short result's tone. */
const metaTone: Partial<Record<StatusState, TextTone>> = {
  failed: "failed",
  waiting: "waiting",
};

/** States whose thing itself steps back to muted: finished, not yet begun, passed over, failed. */
const mutedTarget = new Set<StatusState>(["done", "next", "skipped", "failed"]);

export function StatusRow({
  state,
  verb,
  sub,
  meta,
  actions,
  depth = 0,
  children,
}: {
  state: StatusState;
  /** The status word: "Done", "Working", "Waiting for you". */
  verb?: ReactNode;
  sub?: ReactNode;
  /** Short result on the right. */
  meta?: ReactNode;
  /** Small buttons on the right, such as Stop. */
  actions?: ReactNode;
  depth?: number;
  children: ReactNode;
}) {
  const Icon = state === "plain" ? undefined : icons[state];
  const running = state === "running";
  return (
    <Text
      as="li"
      bare
      tone="muted"
      className="flex items-baseline gap-2 px-3.5 py-2"
      data-state={state}
      style={depth ? { paddingLeft: 14 + depth * 18 } : undefined}
    >
      {Icon ? (
        // The icon sits on the first line of its row, however far the text wraps.
        <Text
          bare
          tone={iconTone[state] ?? "muted"}
          className="flex h-lh shrink-0 items-center self-start"
        >
          <Icon aria-hidden="true" className={running ? "animate-spin" : undefined} />
        </Text>
      ) : null}
      {verb ? (
        <Text
          bare
          tone={verbTone[state]}
          className={cn("shrink-0 whitespace-nowrap", running && "misty-shimmer")}
        >
          {verb}
        </Text>
      ) : null}
      <Text
        bare
        tone={mutedTarget.has(state) ? "muted" : "default"}
        className="min-w-0 flex-1 [overflow-wrap:anywhere]"
      >
        {children}
        {sub ? (
          <Text as="small" bare size="meta" tone="muted" className="mt-0.5 block">
            {sub}
          </Text>
        ) : null}
      </Text>
      {meta ? (
        <Text
          bare
          size="meta"
          tone={metaTone[state] ?? "muted"}
          className="ml-auto pl-3 text-right tabular-nums"
        >
          {meta}
        </Text>
      ) : null}
      {actions ? <span className="inline-flex shrink-0 gap-1.5 self-center">{actions}</span> : null}
    </Text>
  );
}
