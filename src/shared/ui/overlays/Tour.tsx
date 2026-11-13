import * as React from "react";
import { cn } from "../classNames";
import { Button } from "../controls/Button";
import { Text } from "../display/Text";
import { Portal } from "./Portal";
import { popupMotionClass, popupSurfaceClass } from "./popupStyles";
import { ViewportLayer } from "./ViewportLayer";

/** One stop on a tour: the control it lights up, and what to say about it. */
export type TourStep = {
  /**
   * The `data-tour` name of the element to light up. A step whose element isn't on screen is
   * skipped, so a tour never points at nothing; leave it out for a step in the middle of the window.
   */
  target?: string;
  title: string;
  /** One or two plain sentences: what the thing is for, never how it is built. */
  body: string;
};

type Rect = { top: number; left: number; width: number; height: number };

/** Room around the lit element, and between it and the card. */
const HALO = 4;
const GAP = 12;
/** The card's width (w-80) and the edge it keeps from the window. */
const CARD_WIDTH = 320;
const MARGIN = 16;

/**
 * The element a step lights up: of everything tagged with its name, the first one a person can
 * see. A page can hold a second copy laid out but hidden (a closed panel's composer, a pane
 * behind another), which must never be the one pointed at.
 */
function targetOf(step: TourStep | undefined): HTMLElement | null {
  if (!step?.target) return null;
  const tagged = document.querySelectorAll<HTMLElement>(`[data-tour="${step.target}"]`);
  for (const element of Array.from(tagged)) if (seen(element)) return element;
  return null;
}

/** On screen and not hidden by its own or an ancestor's opacity, visibility or display. A wrapper
 * with no box of its own (`display: contents`) counts by what it holds. */
function seen(element: HTMLElement): boolean {
  const boxless = getComputedStyle(element).display === "contents";
  const probes = boxless ? (Array.from(element.children) as HTMLElement[]) : [element];
  const hidden = (probe: HTMLElement) =>
    probe.checkVisibility !== undefined &&
    !probe.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  if (!probes.length || probes.every(hidden)) return false;
  const box = boxOf(element);
  if (!box || box.right - box.left < 1 || box.bottom - box.top < 1) return false;
  return (
    box.bottom > 0 && box.right > 0 && box.top < window.innerHeight && box.left < window.innerWidth
  );
}

/** Whether a control tagged `data-tour={name}` is on screen for a tour to point at. */
export function tourTargetShown(name: string): boolean {
  return targetOf({ target: name, title: "", body: "" }) !== null;
}

/** The element's box, or for a wrapper with no box of its own (`display: contents`), its children's. */
function boxOf(
  element: HTMLElement,
): { top: number; left: number; right: number; bottom: number } | null {
  const box = element.getBoundingClientRect();
  if (box.width > 0 || box.height > 0) return box;
  let union: { top: number; left: number; right: number; bottom: number } | null = null;
  for (const child of Array.from(element.children)) {
    const inner = boxOf(child as HTMLElement);
    if (!inner) continue;
    union = union
      ? {
          top: Math.min(union.top, inner.top),
          left: Math.min(union.left, inner.left),
          right: Math.max(union.right, inner.right),
          bottom: Math.max(union.bottom, inner.bottom),
        }
      : inner;
  }
  return union;
}

function rectOf(element: HTMLElement | null): Rect | null {
  const box = element ? boxOf(element) : null;
  if (!box) return null;
  return {
    top: box.top - HALO,
    left: box.left - HALO,
    width: box.right - box.left + HALO * 2,
    height: box.bottom - box.top + HALO * 2,
  };
}

/**
 * Where the card goes, never over the lit element: beside it for a control along the window's
 * left edge (the sidebar), otherwise under it, then over it, then to its right or left, so it
 * covers as little of what is around the control as it can. With nothing lit, centered.
 */
function cardPosition(rect: Rect | null, cardHeight: number): React.CSSProperties {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const clampTop = (top: number) => Math.max(MARGIN, Math.min(top, height - cardHeight - MARGIN));
  const clampLeft = (left: number) => Math.max(MARGIN, Math.min(left, width - CARD_WIDTH - MARGIN));
  if (!rect) {
    return { top: clampTop((height - cardHeight) / 2), left: clampLeft((width - CARD_WIDTH) / 2) };
  }
  const right = rect.left + rect.width + GAP;
  const left = rect.left - GAP - CARD_WIDTH;
  const below = rect.top + rect.height + GAP;
  const above = rect.top - GAP - cardHeight;
  const sides = {
    right: right + CARD_WIDTH + MARGIN <= width && { top: clampTop(rect.top), left: right },
    left: left >= MARGIN && { top: clampTop(rect.top), left },
    below: below + cardHeight + MARGIN <= height && { top: below, left: clampLeft(rect.left) },
    above: above >= MARGIN && { top: above, left: clampLeft(rect.left) },
  };
  const alongLeftEdge = rect.left + rect.width < width / 3;
  const order = alongLeftEdge
    ? (["right", "below", "above", "left"] as const)
    : (["below", "above", "right", "left"] as const);
  for (const side of order) if (sides[side]) return sides[side];
  return { top: clampTop(above), left: clampLeft(rect.left) };
}

/**
 * A short guided tour over the window: the rest dims, one control at a time is lit, and a card
 * beside it says what it is for, with Back, Next and Skip. Steps whose control isn't on screen
 * are left out. Escape skips, the arrow keys step. `onClose` says whether the person reached the
 * end, so a caller can remember the tour was seen either way.
 *
 * ```tsx
 * <Tour open={open} label="Space tour" steps={spaceTour} onClose={() => markSeen("space")} />
 * ```
 */
export function Tour({
  open,
  label,
  steps,
  onClose,
}: {
  open: boolean;
  /** The tour's accessible name. */
  label: string;
  steps: readonly TourStep[];
  onClose(finished: boolean): void;
}) {
  if (!open) return null;
  return <TourLayer label={label} steps={steps} onClose={onClose} />;
}

function TourLayer({
  label,
  steps,
  onClose,
}: {
  label: string;
  steps: readonly TourStep[];
  onClose(finished: boolean): void;
}) {
  // Only the steps that have something to show, decided once as the tour opens.
  const [shown] = React.useState(() =>
    steps.filter((step) => !step.target || rectOf(targetOf(step))),
  );
  const [index, setIndex] = React.useState(0);
  const [rect, setRect] = React.useState<Rect | null>(null);
  const [cardHeight, setCardHeight] = React.useState(160);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const step = shown[index];
  const last = index === shown.length - 1;

  // Follows the lit element as the window lays out, scrolls or resizes.
  React.useLayoutEffect(() => {
    if (!step) return;
    const element = targetOf(step);
    element?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    let frame = 0;
    const measure = () => {
      setRect((current) => {
        const next = rectOf(targetOf(step));
        const same =
          current === next ||
          (current &&
            next &&
            current.top === next.top &&
            current.left === next.left &&
            current.width === next.width &&
            current.height === next.height);
        return same ? current : next;
      });
      frame = window.requestAnimationFrame(measure);
    };
    measure();
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  const centered = rect === null;
  React.useLayoutEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight);
  }, [index, centered]);

  const next = React.useCallback(() => {
    if (last) onClose(true);
    else setIndex((at) => at + 1);
  }, [last, onClose]);
  const back = React.useCallback(() => setIndex((at) => Math.max(0, at - 1)), []);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose(false);
      else if (event.key === "ArrowRight") next();
      else if (event.key === "ArrowLeft") back();
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [next, back, onClose]);

  React.useEffect(() => {
    if (!step) onClose(true);
  }, [step, onClose]);
  React.useEffect(() => {
    cardRef.current?.querySelector<HTMLButtonElement>("[data-tour-next]")?.focus();
  }, [index]);

  if (!step) return null;
  return (
    <Portal>
      <ViewportLayer layer="blocking-popup" data-slot="tour" aria-label={label}>
        {/* The dim, with a hole over the lit element; it takes the pointer so nothing behind
            it is clicked by mistake mid-tour. */}
        {rect ? (
          <div
            aria-hidden="true"
            className="pointer-events-none fixed rounded-lg shadow-[0_0_0_9999px_var(--color-scrim)] ring-2 ring-cream-bright transition-all duration-200"
            style={rect}
          />
        ) : (
          <div aria-hidden="true" className="fixed inset-0 bg-scrim" />
        )}
        <div className="fixed inset-0" aria-hidden="true" />
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-label={step.title}
          className={cn(
            "fixed grid w-80 gap-3 p-4 transition-[top,left] duration-200",
            popupSurfaceClass,
            popupMotionClass,
          )}
          style={cardPosition(rect, cardHeight)}
        >
          <div className="grid gap-1">
            <Text size="body" weight="semibold" tone="bright" wrap>
              {step.title}
            </Text>
            <Text size="body" tone="muted" wrap>
              {step.body}
            </Text>
          </div>
          <div className="flex items-center gap-2">
            <Text size="meta" tone="muted" className="mr-auto">
              {`${index + 1} of ${shown.length}`}
            </Text>
            {last ? null : (
              <Button variant="quiet" size="sm" onClick={() => onClose(false)}>
                Skip
              </Button>
            )}
            {index > 0 ? (
              <Button size="sm" onClick={back}>
                Back
              </Button>
            ) : null}
            <Button variant="primary" size="sm" data-tour-next onClick={next}>
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </ViewportLayer>
    </Portal>
  );
}
