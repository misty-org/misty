// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useEffect, useMemo, type ReactNode } from "react";
import {
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Pressable,
  RingMeter,
  Surface,
  Text,
  Tooltip,
} from "@misty/ui";
import { rememberContextWindow, resolveContextMax } from "../../view/meta/context_window_memory";
import { formatTokens } from "../../view/meta/format";
import { USAGE_PART_LABELS, usageBreakdown } from "../../view/meta/usage_breakdown";
import type { ContextUsage } from "./context_usage";

const SHADES = ["var(--color-cream)", "var(--color-cream-muted)", "#8a8a8a", "#5f5f5f", "#474747"];

const freeSwatch = (
  <Surface as="span" tone="track" radius="sm" className="size-2.5 shrink-0" aria-hidden="true" />
);

function LegendRow(props: { swatch: ReactNode; label: string; tokens: string; share: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      {props.swatch}
      <Text as="dt" tone="default" className="flex-1">
        {props.label}
      </Text>
      <Text bare as="dd" tone="muted" className="m-0 tabular-nums">
        {props.tokens}
      </Text>
      <Text bare as="dd" tone="default" className="m-0 w-12 text-right tabular-nums">
        {props.share}
      </Text>
    </div>
  );
}

function share(tokens: number, max: number) {
  return max > 0 ? Math.max(0, Math.min(100, (tokens / max) * 100)) : 0;
}

export function ContextMeter(props: { usage?: ContextUsage; engine?: string; model?: string }) {
  const { usage, engine = "", model } = props;
  const slotModel = usage?.model || model;
  useEffect(() => {
    if (engine && usage?.window) rememberContextWindow(engine, slotModel, usage.window);
  }, [engine, slotModel, usage?.window]);
  const max = resolveContextMax({ usage, engine, model: slotModel });
  const breakdown = useMemo(() => usageBreakdown(usage, max), [usage, max]);
  if (!breakdown || !breakdown.used) return null;
  const { used, pct, parts } = breakdown;
  const fraction = pct === undefined ? 0 : pct / 100;
  const title =
    max && pct !== undefined
      ? `Context: ${formatTokens(used)} of ${formatTokens(max)} tokens (${pct}%)`
      : `Context: ${formatTokens(used)} tokens, window unknown`;
  const free = max ? Math.max(0, max - used) : 0;
  return (
    <Popover>
      <Tooltip content={title}>
        <PopoverTrigger asChild>
          <Pressable
            className="inline-grid size-8 place-items-center rounded-lg"
            wash="control"
            aria-label={title}
          >
            <RingMeter value={pct === undefined ? undefined : fraction} />
          </Pressable>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" side="top" data-misty-layer-portal>
        <PopoverHeader
          title="Context window"
          detail={
            <>
              {max ? `${formatTokens(used)} / ${formatTokens(max)}` : formatTokens(used)}
              {pct !== undefined ? ` (${pct}%)` : ""}
            </>
          }
        />
        <PopoverBody>
          {max ? (
            <Surface
              tone="track"
              radius="full"
              className="flex h-1.5 overflow-hidden"
              aria-hidden="true"
            >
              {parts.map((part, index) => (
                <div
                  key={part.kind}
                  className="h-full shrink-0 transition-[width] duration-500 ease-out motion-reduce:transition-none"
                  style={{ width: `${share(part.tokens, max)}%`, background: SHADES[index] }}
                />
              ))}
            </Surface>
          ) : null}
          <dl className="m-0 grid gap-0.5 text-meta">
            {parts.map((part, index) => (
              <LegendRow
                key={part.kind}
                swatch={
                  <span
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ background: SHADES[index] }}
                    aria-hidden="true"
                  />
                }
                label={USAGE_PART_LABELS[part.kind]}
                tokens={formatTokens(part.tokens)}
                share={max ? `${share(part.tokens, max).toFixed(1)}%` : "—"}
              />
            ))}
            {max ? (
              <LegendRow
                swatch={freeSwatch}
                label="Free space"
                tokens={formatTokens(free)}
                share={`${share(free, max).toFixed(1)}%`}
              />
            ) : (
              <LegendRow swatch={freeSwatch} label="Window" tokens="Unknown" share="—" />
            )}
          </dl>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}
