// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { memo, useEffect, useRef, useState } from "react";

/**
 * A number that rolls like an odometer as it changes: each digit is a 0 to 9 strip moved with a
 * plain CSS transition (no masks or blend modes, which misdraw in some web views). It rolls up from
 * 0 on first show, jumps when the person asked for less motion, and its accessible value is always
 * the target number, never the strip.
 */
const DEFAULT_DURATION_MS = 900;
const CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function DigitColumn({ digit, durationMs }: { digit: number; durationMs: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown === digit) return;
    const id = window.requestAnimationFrame(() => setShown(digit));
    return () => window.cancelAnimationFrame(id);
  }, [digit, shown]);
  return (
    <span className="rolling-stat-digit" aria-hidden="true">
      <span
        style={{
          transform: `translateY(-${shown}em)`,
          transitionDuration: `${Math.max(0, durationMs)}ms`,
        }}
      >
        {CELLS.map((cell) => (
          <span key={cell}>{cell}</span>
        ))}
      </span>
    </span>
  );
}

export const RollingStat = memo(function RollingStat({
  value,
  prefix = "",
  className,
  durationMs = DEFAULT_DURATION_MS,
}: {
  value: number;
  prefix?: string;
  className?: string;
  durationMs?: number;
}) {
  const target = Math.max(0, Math.round(value));
  const [displayValue, setDisplayValue] = useState(0);
  const mountedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    let outer = 0;
    let inner = 0;
    // A first value of 0 is already shown; there is nothing to roll.
    if (!mountedRef.current && target === 0) {
      mountedRef.current = true;
      return;
    }
    // Two frames, so the starting value has painted before the transition begins.
    outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => {
        if (cancelled) return;
        setDisplayValue(target);
        mountedRef.current = true;
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(outer);
      window.cancelAnimationFrame(inner);
    };
  }, [target]);
  const digits = String(displayValue).split("").map(Number);
  return (
    <span
      className={`rolling-stat ${className ?? ""}`}
      role="img"
      aria-label={`${prefix}${target}`}
    >
      {prefix ? <span aria-hidden="true">{prefix}</span> : null}
      {digits.map((digit, index) => (
        // Keyed from the right, so a new leading digit mounts on the left and the rest keep rolling.
        <DigitColumn key={digits.length - 1 - index} digit={digit} durationMs={durationMs} />
      ))}
    </span>
  );
});
