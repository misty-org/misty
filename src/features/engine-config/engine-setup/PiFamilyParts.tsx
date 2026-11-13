// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): PiFamilyAuthSection.tsx,
// PiFamilyOauthSection.tsx, PiFamilyApiKeySection.tsx and PiFamilyCustomSection.tsx.
// See NOTICE.
import { cn } from "@/shared/ui";

/** What Pi's and Oh My Pi's provider settings share: rows, cards and a signed-in state. */

export type PiEngine = "pi" | "omp";

export const ROW =
  "flex min-h-[52px] w-full items-center gap-3 border-b border-charcoal-border px-3 py-2.5 last:border-b-0";
export const CARD = "overflow-hidden rounded-xl border border-charcoal-border bg-charcoal-card/40";

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 rounded-full",
        on ? "bg-emerald-400" : "bg-cream-muted/50",
      )}
    />
  );
}

export function State({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 text-xs",
        on ? "text-cream" : "text-cream-muted",
      )}
    >
      <StatusDot on={on} />
      {label}
    </span>
  );
}
