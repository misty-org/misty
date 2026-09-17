import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "./utils";

/** Shared by the shell and component Apps; one viewport also survives separate bundles. */
export function Notification({
  children,
  title,
  tone = "neutral",
  duration = 0,
  onDismiss,
  active = true,
}: {
  children: ReactNode;
  title?: string;
  tone?: "neutral" | "success" | "error";
  /** Actionable notices stay until dismissed or their underlying condition clears. */
  duration?: number;
  onDismiss?: () => void;
  active?: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const latestDismiss = useRef(onDismiss);
  latestDismiss.current = onDismiss;
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const visible = active && !dismissed;
  const dismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  useEffect(() => {
    if (!visible) return;
    let viewport = document.getElementById("misty-notification-viewport");
    if (!viewport) {
      viewport = document.createElement("div");
      viewport.id = "misty-notification-viewport";
      viewport.setAttribute("aria-label", "Notifications");
      viewport.className =
        "pointer-events-none fixed bottom-[max(16px,env(safe-area-inset-bottom))] right-[max(16px,env(safe-area-inset-right))] z-[2147482900] flex max-h-[calc(100dvh-80px)] w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2 overflow-y-auto";
      document.body.append(viewport);
    }
    const slot = document.createElement("div");
    slot.className = "contents";
    viewport.append(slot);
    setTarget(slot);
    return () => {
      slot.remove();
      if (!viewport.childElementCount) viewport.remove();
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || !duration || paused) return;
    const timer = window.setTimeout(() => {
      setDismissed(true);
      latestDismiss.current?.();
    }, duration);
    return () => window.clearTimeout(timer);
  }, [visible, duration, paused]);

  const Icon = tone === "error" ? TriangleAlert : tone === "success" ? Check : Info;
  if (!visible || !target) return null;
  return createPortal(
    <aside
      role={tone === "error" ? "alert" : "status"}
      aria-atomic="true"
      data-misty-notification="true"
      data-misty-window-drag-block="true"
      className="pointer-events-auto relative flex shrink-0 items-start gap-2.5 rounded-lg border border-charcoal-border bg-charcoal-card p-3 text-sm text-cream"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4 shrink-0 text-cream-muted",
          tone === "success" && "text-sage-fg",
        )}
      />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        {title ? <p className="mb-1 font-semibold leading-snug">{title}</p> : null}
        <div className="text-xs leading-relaxed text-cream-muted [&_button]:mt-2 [&_button]:mr-2 [&_button]:rounded [&_button]:px-2 [&_button]:py-1 [&_button]:text-cream [&_button]:underline [&_button]:underline-offset-2 [&_button]:hover:bg-charcoal-hover [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-cream-muted">
          {children}
        </div>
      </div>
      <button
        type="button"
        aria-label={title ? `Dismiss ${title}` : "Dismiss notification"}
        onClick={dismiss}
        className="grid size-6 shrink-0 place-items-center rounded text-cream-muted hover:bg-charcoal-hover hover:text-cream-bright focus-visible:outline-2 focus-visible:outline-cream-muted"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </aside>,
    target,
  );
}
