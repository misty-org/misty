import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A desktop window frame drawn in DOM rather than captured as a screenshot.
 *
 * Everything inside renders on `.app-chrome`, which swaps in the desktop
 * app's charcoal palette and the platform UI font. That combination — real
 * app colors, real app typeface, real app geometry — is what makes the frame
 * read as a window instead of an illustration of one.
 */
export function AppWindow({
  title,
  children,
  className,
  shadow = true,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  /** Off when the frame sits on a dark band, where a drop shadow is invisible. */
  shadow?: boolean;
}) {
  return (
    <div
      className={cn(
        "app-chrome flex flex-col overflow-hidden rounded-xl border border-[var(--app-border)]",
        // A drop shadow does nothing for a dark window on a dark page, so a
        // hairline ring carries the separation in dark mode instead.
        "ring-1 ring-black/5 dark:ring-white/[0.07]",
        shadow && "shadow-2xl shadow-black/25 dark:shadow-black/50",
        className,
      )}
    >
      <div className="flex h-9 shrink-0 items-center border-b border-[var(--app-border)] bg-[var(--app-workspace)] px-3.5">
        <div className="flex items-center gap-[6px]">
          <span className="size-[11px] rounded-full bg-[#ff5f57]" />
          <span className="size-[11px] rounded-full bg-[#febc2e]" />
          <span className="size-[11px] rounded-full bg-[#28c840]" />
        </div>
        <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[12px] font-medium text-[var(--app-ink-muted)]">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

/**
 * The strip along the bottom of the app window.
 *
 * This is the highest-leverage line of text in any Misty mockup: `left` says
 * what stays private, `right` says what the group can see, and reading the
 * two together is the product's actual claim stated as ordinary UI rather
 * than as marketing copy. Keep both factual and keep both short.
 *
 * `right` drops out on a narrow window rather than wrapping the bar to two
 * lines — a status bar that reflows stops reading as chrome.
 */
export function AppStatusBar({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-4 overflow-hidden border-t border-[var(--app-border)] bg-[var(--app-workspace)] px-4 text-[11px] whitespace-nowrap text-[var(--app-ink-muted)]">
      <span className="truncate">{left}</span>
      <span className="ml-auto hidden truncate @xl:inline">{right}</span>
    </div>
  );
}

/** A small pill used inside mockups for counts, scopes, and states. */
export function AppChip({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "bright";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-[2px] text-[10px] leading-none",
        tone === "bright"
          ? "border-[var(--app-active)] text-[var(--app-ink-bright)]"
          : "border-[var(--app-border)] text-[var(--app-ink-muted)]",
      )}
    >
      {children}
    </span>
  );
}
