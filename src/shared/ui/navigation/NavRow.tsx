import { ChevronRight } from "lucide-react";
import type { ComponentPropsWithoutRef, HTMLAttributes, ReactNode, Ref } from "react";

import { cn } from "../classNames";
import { Pressable } from "../controls/Pressable";
import { OverflowFadeText, type OverflowFadeTextProps } from "../layout/OverflowFadeText";

/**
 * How a sidebar row answers the pointer:
 * - `wash`: Pressable's row wash, which brightens all of its text too (the sidebar's places). The
 *   open row's text is brighter as well.
 * - `fill`: only the row's fill, leaving its marks and times quiet; its `NavRowLabel` brightens on
 *   its own (a list of chats).
 */
export type NavRowHover = "wash" | "fill";

export type NavRowProps = Omit<ComponentPropsWithoutRef<"button">, "ref"> & {
  /** The open page's row: the active fill, and `aria-current="page"`. */
  current?: boolean;
  /** Picked among several, or being renamed in place: the open row's fill without being it. */
  selected?: boolean;
  hover?: NavRowHover;
  /**
   * Not pressed as a whole: a placeholder while the list loads, or the row while it holds a field.
   * It is a `div` that stands still under the pointer.
   */
  still?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

const chromeText = "text-[var(--workspace-tab-text)]";
const chromeMuted = "text-[var(--workspace-tab-muted)]";
const focusRing =
  "focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-cream-muted";

/**
 * One row of the window's sidebar: 32px, a 16px mark, its label, and what sits at its end, in the
 * chrome's quiet text (Text `chrome-muted`). The open row takes the active fill.
 *
 * ```tsx
 * <NavRow current={here} onClick={open}><Icon />…<OverflowFadeText>{label}</OverflowFadeText></NavRow>
 * <NavRow hover="fill" selected={picked}>…<NavRowLabel bright={unread}>{title}</NavRowLabel></NavRow>
 * ```
 */
export function NavRow({
  current,
  selected,
  hover = "wash",
  still,
  className,
  ref,
  ...props
}: NavRowProps) {
  const filled = current || selected;
  const classes = cn(
    "group/nav-row flex h-8 w-full min-w-0 flex-none items-center gap-2 rounded-md px-2",
    "text-left text-control",
    focusRing,
    "focus-visible:-outline-offset-1",
    hover === "wash" && current ? chromeText : chromeMuted,
    filled && "bg-row-active",
    !still && !filled && hover === "fill" && "hover:bg-row-hover",
    className,
  );
  if (still) {
    const { type: _type, ...rest } = props;
    return (
      <div
        data-slot="nav-row"
        {...(rest as HTMLAttributes<HTMLDivElement>)}
        aria-current={current ? "page" : undefined}
        className={classes}
      />
    );
  }
  return (
    <Pressable
      ref={ref}
      type="button"
      wash={hover === "wash" ? "row" : undefined}
      aria-current={current ? "page" : undefined}
      {...props}
      className={classes}
    />
  );
}

/**
 * A `fill` row's title. It takes the chrome's own text under the pointer, and `bright` keeps it
 * there (the open, picked or unread row's title).
 */
export function NavRowLabel({
  bright,
  className,
  ...props
}: OverflowFadeTextProps & { bright?: boolean }) {
  return (
    <OverflowFadeText
      {...props}
      className={cn(
        "text-control",
        bright ? chromeText : "group-hover/nav-row:text-[var(--workspace-tab-text)]",
        className,
      )}
    />
  );
}

export interface NavGroupHeadingProps extends HTMLAttributes<HTMLDivElement> {
  /** The group's name. Without it the heading holds its `children` alone (a placeholder). */
  name?: ReactNode;
  /** A group that folds away: its name is a button showing how many it holds, and a chevron. */
  collapsible?: { open: boolean; count: number; onToggle(): void };
  ref?: Ref<HTMLDivElement>;
}

/**
 * The heading over a group of sidebar rows (Pinned, a section, Archived): 28px, the caption role
 * at medium weight, in the chrome's quiet text, brightening under the pointer.
 */
export function NavGroupHeading({
  name,
  collapsible,
  className,
  children,
  ref,
  ...props
}: NavGroupHeadingProps) {
  const nameClass = cn(
    "flex min-w-0 items-center gap-1 rounded-md text-caption font-medium",
    "hover:text-[var(--workspace-tab-text)]",
  );
  const label = collapsible ? (
    <Pressable
      type="button"
      className={cn(nameClass, focusRing, "focus-visible:outline-offset-2")}
      aria-expanded={collapsible.open}
      onClick={collapsible.onToggle}
    >
      {name}
      <span className="tabular-nums opacity-70">{collapsible.count}</span>
      <ChevronRight
        aria-hidden="true"
        className={cn(
          "transition-transform duration-120 ease-[ease] motion-reduce:transition-none",
          collapsible.open && "rotate-90",
        )}
      />
    </Pressable>
  ) : name !== undefined ? (
    <span className={nameClass}>{name}</span>
  ) : null;
  return (
    <div
      ref={ref}
      data-slot="nav-group-heading"
      {...props}
      className={cn("flex h-7 items-center justify-between gap-1 pl-2", chromeMuted, className)}
    >
      {label}
      {children}
    </div>
  );
}
