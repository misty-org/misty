import {
  useCallback,
  useLayoutEffect,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { cn } from "../classNames";
import { Tooltip } from "../overlays/Tooltip";

/** The elements a label can be. A label is one line of text, or two with `lines={2}`. */
export type OverflowFadeElement = "span" | "div" | "p" | "h1" | "h2" | "h3" | "h4";

export interface OverflowFadeTextProps extends HTMLAttributes<HTMLElement> {
  /** The element to render. Defaults to `span`, laid out as a block so it can clip. */
  as?: OverflowFadeElement;
  /**
   * Shows the whole text in a tooltip, only while it doesn't fit. `true` uses the label's own
   * text; a string is shown instead, for a label whose children aren't plain text.
   */
  full?: boolean | string;
  /** How many lines the text may take before it fades. Two-line text wraps between words. */
  lines?: 1 | 2;
  ref?: Ref<HTMLElement>;
  children?: ReactNode;
}

const layoutClass = {
  1: "block min-w-0 overflow-hidden whitespace-nowrap",
  2: "block min-w-0 overflow-hidden whitespace-normal [overflow-wrap:anywhere] max-h-[2lh]",
} as const;
const fadeClass = { 1: "fade-end", 2: "fade-end-2" } as const;

/**
 * Long text (names, models, paths, branches) shortens with a fade at its end, never an ellipsis.
 * The fade appears only while the text doesn't fit, and follows the label as its box or text
 * changes. This is the default for every label in shared components.
 */
export function OverflowFadeText({
  as: Tag = "span",
  className,
  children,
  full,
  lines = 1,
  ref,
  ...props
}: OverflowFadeTextProps) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [text, setText] = useState("");

  // A callback ref, so measuring follows the element when the tooltip wrapper remounts it.
  const attach = useCallback(
    (node: HTMLElement | null) => {
      setElement(node);
      assignRef(ref, node);
    },
    [ref],
  );

  const measure = useCallback(() => {
    if (!element) return;
    const next =
      lines === 2
        ? element.scrollHeight > element.clientHeight + 1
        : element.scrollWidth > element.clientWidth + 1;
    setOverflowing((current) => (current === next ? current : next));
    if (full === true) setText(element.textContent ?? "");
  }, [element, lines, full]);

  useLayoutEffect(() => {
    if (!element) return;
    const stopResize = watchSize(element, measure);
    // Text that changes inside a child component never changes this one's children.
    const mutations =
      typeof MutationObserver === "undefined" ? null : new MutationObserver(measure);
    mutations?.observe(element, { characterData: true, childList: true, subtree: true });
    return () => {
      stopResize();
      mutations?.disconnect();
    };
  }, [element, measure]);

  // New children re-measure without setting the observers up again on every render.
  useLayoutEffect(measure, [measure, children]);

  const label = (
    <Tag
      {...props}
      ref={attach}
      className={cn(layoutClass[lines], className, overflowing && fadeClass[lines])}
      data-text-overflowing={overflowing ? "true" : "false"}
    >
      {children}
    </Tag>
  );

  const tooltip = typeof full === "string" ? full : full ? text : "";
  if (!overflowing || !tooltip) return label;
  return <Tooltip content={tooltip}>{label}</Tooltip>;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as RefObject<T | null>).current = value;
}

// One observer for every label on screen: a long list shouldn't carry an observer per row.
const sizeWatchers = new Map<Element, () => void>();
let sizeObserver: ResizeObserver | null = null;

function watchSize(element: HTMLElement, update: () => void) {
  if (typeof ResizeObserver === "undefined") {
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }
  sizeObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) sizeWatchers.get(entry.target)?.();
  });
  sizeWatchers.set(element, update);
  sizeObserver.observe(element);
  return () => {
    if (sizeWatchers.get(element) === update) sizeWatchers.delete(element);
    sizeObserver?.unobserve(element);
  };
}
