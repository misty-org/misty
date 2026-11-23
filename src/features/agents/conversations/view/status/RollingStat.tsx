// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { memo, useEffect, useRef, useState } from "react";
import { cn } from "@misty/ui";

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
    <span className="inline-block h-[1em] overflow-hidden" aria-hidden="true">
      <span
        className={
          "flex flex-col transition-transform ease-[cubic-bezier(0.22,1,0.36,1)] " +
          "motion-reduce:transition-none"
        }
        style={{
          transform: `translateY(-${shown}em)`,
          transitionDuration: `${Math.max(0, durationMs)}ms`,
        }}
      >
        {CELLS.map((cell) => (
          <span key={cell} className="block h-[1em] leading-none">
            {cell}
          </span>
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
    if (!mountedRef.current && target === 0) {
      mountedRef.current = true;
      return;
    }
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
      className={cn("inline-flex items-center leading-none", className)}
      role="img"
      aria-label={`${prefix}${target}`}
    >
      {prefix ? <span aria-hidden="true">{prefix}</span> : null}
      {digits.map((digit, index) => (
        <DigitColumn key={digits.length - 1 - index} digit={digit} durationMs={durationMs} />
      ))}
    </span>
  );
});
