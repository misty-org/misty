import { Check, Circle, CircleAlert, CircleMinus, CircleX, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn, Spinner, Surface, Text, type TextTone } from "@misty/ui";
import { remCss } from "@misty/ui";

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
  head?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Surface
      as="section"
      tone="faint"
      radius="xl"
      className="mt-1.5 mb-2 overflow-hidden text-control leading-normal"
      aria-label={label}
    >
      {head ? (
        <Text as="div" bare size="caption" tone="muted" className="block px-3.5 py-2">
          {head}
        </Text>
      ) : null}
      <ol className="m-0 list-none p-0">{children}</ol>
      {actions ? <div className="flex flex-wrap gap-2 px-3.5 py-2.5">{actions}</div> : null}
    </Surface>
  );
}

const iconTone: Partial<Record<StatusState, TextTone>> = {
  done: "done",
  failed: "failed",
  waiting: "waiting",
  stopped: "waiting",
};

const verbTone: Partial<Record<StatusState, TextTone>> = {
  waiting: "waiting",
  stopped: "waiting",
};

const metaTone: Partial<Record<StatusState, TextTone>> = {
  failed: "failed",
  waiting: "waiting",
};

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
  verb?: ReactNode;
  sub?: ReactNode;
  meta?: ReactNode;
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
      style={depth ? { paddingLeft: remCss(14 + depth * 18) } : undefined}
    >
      {Icon ? (
        <Text
          bare
          tone={iconTone[state] ?? "muted"}
          className="flex h-lh shrink-0 items-center self-start"
        >
          {running ? <Spinner label={false} /> : <Icon aria-hidden="true" />}
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
