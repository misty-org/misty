import { Button, cn } from "@/shared/ui";
import { useEffect, useState, type ReactNode } from "react";

export function TourPopover(props: {
  stepNumber: number;
  totalSteps: number;
  title: string;
  description: string;
  actionHint?: string;
  primaryLabel?: string;
  showBack?: boolean;
  targetSelector?: string;
  children?: ReactNode;
  onNext: () => void;
  onBack?: () => void;
  onSkip: () => void;
}) {
  const {
    stepNumber,
    totalSteps,
    title,
    description,
    actionHint,
    primaryLabel = "Next",
    showBack = false,
    targetSelector,
    children,
    onNext,
    onBack,
    onSkip,
  } = props;

  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!targetSelector) {
      setCoords(null);
      return;
    }

    const updatePosition = () => {
      const el = document.querySelector<HTMLElement>(targetSelector);
      if (el) {
        const rect = el.getBoundingClientRect();
        const popoverWidth = 340;
        const popoverHeight = 240;

        let left = rect.right + 16;
        let top = Math.max(16, rect.top);

        // If right side overflows viewport, place on left
        if (left + popoverWidth > window.innerWidth - 16) {
          left = Math.max(16, rect.left - popoverWidth - 16);
        }

        // If left side also overflows or overlaps, place below or above
        if (left < 16 || (left < rect.right && left + popoverWidth > rect.left)) {
          left = Math.max(16, Math.min(rect.left, window.innerWidth - popoverWidth - 16));
          top = rect.bottom + 16;
        }

        // If bottom overflows viewport, place above
        if (top + popoverHeight > window.innerHeight - 16) {
          top = Math.max(16, rect.top - popoverHeight - 16);
        }

        // Final sanity clamping
        left = Math.max(16, Math.min(left, window.innerWidth - popoverWidth - 16));
        top = Math.max(16, Math.min(top, window.innerHeight - popoverHeight - 16));

        setCoords({ top, left });
      } else {
        setCoords(null);
      }
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [targetSelector]);

  const style = coords
    ? { top: `${coords.top}px`, left: `${coords.left}px` }
    : undefined;

  return (
    <div
      className={cn(
        "fixed z-[100] w-[340px] rounded-lg border border-charcoal-border bg-charcoal-card p-5 text-cream",
        "shadow-2xl ring-1 ring-cream/10 transition-all duration-200 ease-out",
      )}
      style={style ?? { top: "25%", left: "50%", transform: "translateX(-50%)" }}
      role="dialog"
      aria-label={title}
    >
      <div className="flex items-center justify-between pb-3 border-b border-charcoal-border/70">
        <span className="text-[11px] font-medium uppercase tracking-wider text-cream-muted">
          Step {stepNumber} of {totalSteps}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-xs text-cream-muted hover:text-cream-bright font-normal"
          onClick={onSkip}
        >
          Skip tour
        </Button>
      </div>

      <div className="mt-3.5">
        <h3 className="text-sm font-semibold text-cream-bright leading-tight">{title}</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-cream-muted">{description}</p>
        {actionHint ? (
          <div className="mt-3 rounded-md border border-charcoal-border bg-charcoal-bg/70 px-2.5 py-1.5 text-[11px] leading-normal text-cream">
            {actionHint}
          </div>
        ) : null}
      </div>

      {children ? <div className="mt-3">{children}</div> : null}

      <div className="mt-5 flex items-center justify-between gap-2 pt-2 border-t border-charcoal-border/50">
        <div>
          {showBack ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={onBack}
            >
              Back
            </Button>
          ) : null}
        </div>
        <Button
          type="button"
          variant="default"
          size="sm"
          className="h-8 px-4 text-xs font-medium"
          onClick={onNext}
        >
          {primaryLabel}
        </Button>
      </div>
    </div>
  );
}
