// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): PiFamilyAuthSection.tsx,
// PiFamilyOauthSection.tsx, PiFamilyApiKeySection.tsx and PiFamilyCustomSection.tsx.
// See NOTICE.
import type { ReactNode } from "react";
import { cn, Surface, Text } from "@/shared/ui";

/** What Pi's and Oh My Pi's provider settings share: rows, cards and a signed-in state. */

export type PiEngine = "pi" | "omp";

export const ROW = "flex min-h-13 w-full items-center gap-3 border-b px-3 py-2.5 last:border-b-0";

/** The card a list of provider rows sits on. */
export function RowsCard({ children }: { children: ReactNode }) {
  return (
    <Surface tone="card" edge="hairline" radius="xl" className="overflow-hidden">
      {children}
    </Surface>
  );
}

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 rounded-full",
        // Off, the dot is the muted text color at half strength.
        on ? "bg-emerald-400" : "bg-current/50",
      )}
    />
  );
}

export function State({ on, label }: { on: boolean; label: string }) {
  return (
    <Text
      bare
      tone={on ? "default" : "muted"}
      className="flex shrink-0 items-center gap-1.5 text-xs"
    >
      <StatusDot on={on} />
      {label}
    </Text>
  );
}
