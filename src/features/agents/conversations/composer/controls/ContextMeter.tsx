// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useEffect, useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger, Pressable } from "@/shared/ui";
import { rememberContextWindow, resolveContextMax } from "../../view/meta/contextWindowMemory";
import { formatTokens } from "../../view/meta/format";
import { USAGE_PART_LABELS, usageBreakdown } from "../../view/meta/usageBreakdown";
import type { ContextUsage } from "./contextUsage";

/** Bucket shades: neutral steps, since a token bucket carries no meaning that needs a hue. */
const SHADES = ["var(--color-cream)", "var(--color-cream-muted)", "#8a8a8a", "#5f5f5f", "#474747"];

function share(tokens: number, max: number) {
  return max > 0 ? Math.max(0, Math.min(100, (tokens / max) * 100)) : 0;
}

/**
 * How full the engine's context is: a small ring that opens to a breakdown of the last report,
 * one row per token bucket with its share of the window, then the free space. A window the engine
 * never reported reads as unknown: nothing is measured against a guess.
 */
export function ContextMeter(props: {
  usage?: ContextUsage;
  /** The engine and the model chosen, to remember the window a report gave for next time. */
  engine?: string;
  model?: string;
}) {
  const { usage, engine = "", model } = props;
  const slotModel = usage?.model || model;
  useEffect(() => {
    if (engine && usage?.window) rememberContextWindow(engine, slotModel, usage.window);
  }, [engine, slotModel, usage?.window]);
  const max = resolveContextMax({ usage, engine, model: slotModel });
  const breakdown = useMemo(() => usageBreakdown(usage, max), [usage, max]);
  if (!breakdown || !breakdown.used) return null;
  const { used, pct, parts } = breakdown;
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const fraction = pct === undefined ? 0 : pct / 100;
  const title =
    max && pct !== undefined
      ? `Context: ${formatTokens(used)} of ${formatTokens(max)} tokens (${pct}%)`
      : `Context: ${formatTokens(used)} tokens, window unknown`;
  const free = max ? Math.max(0, max - used) : 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Pressable className="composer-meter" aria-label={title} title={title}>
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
            <circle
              cx="8"
              cy="8"
              r={radius}
              fill="none"
              strokeWidth="2"
              className="stroke-charcoal-border"
              strokeDasharray={pct === undefined ? "2 2" : undefined}
            />
            {pct !== undefined ? (
              <circle
                cx="8"
                cy="8"
                r={radius}
                fill="none"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={`${fraction * circumference} ${circumference}`}
                transform="rotate(-90 8 8)"
                className={fraction > 0.85 ? "stroke-cream" : "stroke-cream-muted"}
              />
            ) : null}
          </svg>
        </Pressable>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="context-meter-card" data-misty-layer-portal>
        <div className="context-meter-header">
          <span>Context window</span>
          <span className="context-meter-total">
            {max ? `${formatTokens(used)} / ${formatTokens(max)}` : formatTokens(used)}
            {pct !== undefined ? ` (${pct}%)` : ""}
          </span>
        </div>
        {max ? (
          <div className="context-meter-bar" aria-hidden="true">
            {parts.map((part, index) => (
              <div
                key={part.kind}
                style={{ width: `${share(part.tokens, max)}%`, background: SHADES[index] }}
              />
            ))}
          </div>
        ) : null}
        <dl className="context-meter-legend">
          {parts.map((part, index) => (
            <div key={part.kind} className="context-meter-row">
              <span
                className="context-meter-swatch"
                style={{ background: SHADES[index] }}
                aria-hidden="true"
              />
              <dt>{USAGE_PART_LABELS[part.kind]}</dt>
              <dd>{formatTokens(part.tokens)}</dd>
              <dd className="context-meter-share">
                {max ? `${share(part.tokens, max).toFixed(1)}%` : "—"}
              </dd>
            </div>
          ))}
          {max ? (
            <div className="context-meter-row">
              <span className="context-meter-swatch" data-free aria-hidden="true" />
              <dt>Free space</dt>
              <dd>{formatTokens(free)}</dd>
              <dd className="context-meter-share">{share(free, max).toFixed(1)}%</dd>
            </div>
          ) : (
            <div className="context-meter-row">
              <span className="context-meter-swatch" data-free aria-hidden="true" />
              <dt>Window</dt>
              <dd>Unknown</dd>
              <dd className="context-meter-share">—</dd>
            </div>
          )}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
