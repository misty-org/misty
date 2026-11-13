import { Slot } from "@radix-ui/react-slot";
import { useNow } from "../../hooks/useNow";
import { RowControls } from "../controls/rowContext";
import { Check } from "lucide-react";
import * as React from "react";
import { cn } from "../classNames";
import { itemToneClass, type ItemTone } from "../icons/itemTones";
import { renderIcon, type IconSource } from "../layout/ActionBar";
import { OverflowFadeText } from "../layout/OverflowFadeText";
import { RowActions } from "../overlays/RowActions";
import { SkeletonControl, trailingControls, type SkeletonTrailing } from "../feedback/Skeleton";
import { StateMark, type StateMarkKind } from "./StateMark";

/**
 * What a row shows at its right end. A row has one state at a time: the agent working on it, the
 * agent waiting on the person, something unread, its run done or failed, or the time it last
 * changed. A mark's `label` replaces its tooltip, such as the reason a run failed.
 */
export type RowState =
  | { kind: StateMarkKind; label?: string }
  | { kind: "time"; at: Date | string | number }
  | { kind: "none" };

export type ListRowProps = {
  /** The row's text. It fades at the edge when it is too long. */
  label: string;
  /**
   * What the item is, before the label: a 16px icon (`leading={FileText}`), or an element such as
   * an engine mark or an avatar (`<Avatar size="xs">`, up to `sm`), drawn as given.
   */
  leading?: IconSource;
  /** Colors a component `leading` icon by the kind of item, like file and folder glyphs. */
  leadingTone?: ItemTone;
  /**
   * A muted line under the label, such as a description or where the item comes from. The row
   * grows to two lines and the line fades like the label.
   */
  description?: string;
  /** A small mark right after the label, such as a Badge naming the item's source. */
  badge?: React.ReactNode;
  /**
   * Controls that stay visible at the row's right end, before its state and ⋯, such as an
   * Install button or a set of engine toggles. Clicks on them never open the row.
   */
  trailing?: React.ReactNode;
  /** Opens the item. Without `href` the row is a button. */
  onOpen?: (event: React.MouseEvent<HTMLElement>) => void;
  /** A link target; the row renders as an anchor. */
  href?: string;
  /** Renders the one child (a router Link) as the row's open target instead of a button. */
  asChild?: boolean;
  /** The child for `asChild`; its own content is replaced by the label. */
  children?: React.ReactElement;
  /** The open item: a neutral fill. */
  selected?: boolean;
  /**
   * Picked in a multi-select, apart from the open item (`selected`): a checkmark takes the
   * state's place at the right end, and the ⋯ still replaces it on hover.
   */
  checked?: boolean;
  state?: RowState;
  /**
   * The row's actions as menu items. They open from the ⋯ at the right end, which replaces the
   * state on hover and focus, and from a right-click on the row.
   */
  menu?: React.ReactNode;
  /** The ⋯ button's name, such as "Chat actions". Defaults to "Actions for {label}". */
  menuLabel?: string;
  draggable?: boolean;
  onDragStart?: React.DragEventHandler<HTMLElement>;
  onDragEnd?: React.DragEventHandler<HTMLElement>;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "onDragStart" | "onDragEnd" | "children" | "id">;

const dayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const yearFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** A short time for the end of a row: now, 5m, 3h, 2d, then the date. */
export function formatRowTime(at: Date | string | number, reference: number): string {
  const date = at instanceof Date ? at : new Date(at);
  const time = date.getTime();
  if (Number.isNaN(time)) return "";
  const minutes = Math.floor(Math.max(0, reference - time) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const sameYear = date.getFullYear() === new Date(reference).getFullYear();
  return (sameYear ? dayFormat : yearFormat).format(date);
}

function RowTime({ at }: { at: Date | string | number }) {
  const reference = useNow();
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <time
      dateTime={date.toISOString()}
      className="whitespace-nowrap text-meta tabular-nums text-cream-muted"
    >
      {formatRowTime(date, reference)}
    </time>
  );
}

function RowStateMark({ state }: { state: RowState }) {
  if (state.kind === "none") return null;
  if (state.kind === "time") return <RowTime at={state.at} />;
  return <StateMark kind={state.kind} label={state.label} />;
}

/**
 * The one list row for chats, pages, pins, files and catalog entries: 32px with its state at the
 * right end, or two lines with a `description`. It may start with what the item is (`leading`)
 * and keep controls in view at its end (`trailing`). With a `menu`, a ⋯ takes the state's place
 * on hover or focus and the same menu opens on right-click.
 */
const ListRow = React.forwardRef<HTMLElement, ListRowProps>(
  (
    {
      label,
      leading,
      leadingTone,
      description,
      badge,
      trailing,
      onOpen,
      href,
      asChild = false,
      children,
      selected = false,
      checked,
      state = { kind: "none" },
      menu,
      menuLabel,
      draggable,
      onDragStart,
      onDragEnd,
      disabled,
      className,
      id,
      "aria-label": ariaLabel,
      ...rest
    },
    ref,
  ) => {
    const Open: React.ElementType = asChild ? Slot : href ? "a" : "button";
    const openProps =
      Open === "button" ? { type: "button" as const, disabled } : href ? { href } : {};
    const hasState = state.kind !== "none" || Boolean(checked);
    const hasMenu = menu !== undefined && menu !== null && menu !== false;
    const hasTrailing = trailing !== undefined && trailing !== null && trailing !== false;
    const descriptionId = React.useId();
    const text = (
      <>
        {leading ? (
          <span
            data-slot="list-row-leading"
            aria-hidden="true"
            className={cn(
              "flex min-w-4 shrink-0 items-center justify-center",
              leadingTone ? itemToneClass(leadingTone) : "text-cream-muted",
            )}
          >
            {renderIcon(leading, "size-4")}
          </span>
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <OverflowFadeText full className={badge ? "min-w-0 shrink" : "flex-1"}>
              {label}
            </OverflowFadeText>
            {badge ? <span className="flex shrink-0 items-center">{badge}</span> : null}
          </span>
          {description ? (
            <OverflowFadeText
              full
              id={descriptionId}
              data-slot="list-row-description"
              className="text-meta text-cream-muted"
            >
              {description}
            </OverflowFadeText>
          ) : null}
        </span>
      </>
    );
    return (
      <div
        {...rest}
        data-slot="list-row"
        data-selected={selected || undefined}
        data-checked={checked || undefined}
        data-disabled={disabled || undefined}
        data-two-line={description ? true : undefined}
        className={cn(
          "group/row relative flex min-w-0 items-center gap-2 rounded-md px-2",
          description ? "min-h-12 py-1.5" : "h-8",
          "text-control text-cream transition-colors",
          "hover:bg-control-hover has-[:focus-visible]:bg-control-hover",
          "data-[selected]:bg-control-active data-[selected]:text-cream-bright",
          "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
          className,
        )}
      >
        <Open
          ref={ref}
          id={id}
          {...openProps}
          // With a description, the row is named by its label and described by the line.
          aria-label={ariaLabel ?? (description ? label : undefined)}
          aria-describedby={description ? descriptionId : undefined}
          aria-current={selected ? "true" : undefined}
          draggable={draggable}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onClick={onOpen}
          data-slot="list-row-open"
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 self-stretch text-left outline-none",
            // The open target covers the whole row, so its padding opens it too; the right slot
            // sits above it.
            "after:absolute after:inset-0 after:rounded-md after:content-['']",
          )}
        >
          {asChild && React.isValidElement(children)
            ? React.cloneElement(
                children as React.ReactElement<{ children?: React.ReactNode }>,
                undefined,
                text,
              )
            : text}
        </Open>
        {hasTrailing ? (
          // Above the open target, which covers the whole row.
          <span data-slot="list-row-trailing" className="relative flex shrink-0 items-center gap-1">
            <RowControls>{trailing}</RowControls>
          </span>
        ) : null}
        {hasState || hasMenu ? (
          <span
            data-slot="list-row-end"
            className="relative grid h-6 min-w-6 shrink-0 place-items-center [&>*]:col-start-1 [&>*]:row-start-1"
          >
            {hasState ? (
              <span
                data-slot="list-row-state"
                className={cn(
                  "flex items-center justify-end",
                  // The ⋯ shows on exactly these conditions (RowActions), so the two never overlap.
                  hasMenu && [
                    "group-hover/row:invisible group-focus-within/row:invisible",
                    "group-has-[[data-state=open]]/row:invisible group-has-[[data-context-open]]/row:invisible",
                  ],
                )}
              >
                {checked ? (
                  <Check role="img" aria-label="Selected" className="size-4 text-cream-bright" />
                ) : (
                  <RowStateMark state={state} />
                )}
              </span>
            ) : null}
            {hasMenu ? (
              <span
                data-slot="list-row-actions"
                className={cn(
                  "flex items-center justify-end opacity-0 transition-opacity",
                  "group-hover/row:opacity-100 group-focus-within/row:opacity-100",
                  "has-[[data-state=open]]:opacity-100 has-[[data-context-open]]:opacity-100",
                )}
              >
                <RowActions label={menuLabel ?? `Actions for ${label}`}>{menu}</RowActions>
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
    );
  },
);
ListRow.displayName = "ListRow";

const skeletonWidths = ["w-2/3", "w-1/2", "w-3/5", "w-2/5", "w-3/4"];

/** Placeholder rows with ListRow's geometry, for a list's first load. */
function ListRowSkeleton({
  label,
  rows = 5,
  state = false,
  leading = false,
  lines = 1,
  trailing = false,
  className,
}: {
  /** What is loading, for screen readers. */
  label: string;
  rows?: number;
  /** Draws a short mark at the right end, for lists whose rows show a time. */
  state?: boolean;
  /** Draws the 16px leading block, for rows that start with an icon. */
  leading?: boolean;
  /** 2 for rows with a description line. */
  lines?: 1 | 2;
  /** The controls at each row's right end (`trailing` on ListRow), at their real sizes. */
  trailing?: SkeletonTrailing;
  className?: string;
}) {
  const ends = trailingControls(trailing);
  return (
    <div role="status" aria-label={label} aria-busy="true" className={cn("grid", className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className={cn("flex items-center gap-2 px-2", lines === 2 ? "h-12" : "h-8")}
        >
          {leading ? (
            <div className="misty-skeleton size-4 shrink-0 rounded-sm bg-control-hover" />
          ) : null}
          <div className="grid min-w-0 flex-1 gap-2">
            <div
              className={cn(
                "misty-skeleton h-3 rounded-sm bg-control-hover",
                skeletonWidths[index % skeletonWidths.length],
              )}
            />
            {lines === 2 ? (
              <div className="misty-skeleton h-2.5 w-1/3 rounded-sm bg-control-hover" />
            ) : null}
          </div>
          {state ? (
            <div className="misty-skeleton h-3 w-6 shrink-0 rounded-sm bg-control-hover" />
          ) : null}
          {ends.map((control, end) => (
            <SkeletonControl key={end} kind={control.kind} className={control.className} />
          ))}
        </div>
      ))}
    </div>
  );
}

export { ListRow, ListRowSkeleton };
