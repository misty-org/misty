"use client";
import { useOverlaySide } from "./OverlaySide";
import { OutOfRow } from "../controls/RowContext";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Search, X } from "lucide-react";
import * as React from "react";

import {
  pickerSearchInputClass,
  pickerSearchRowClass,
  popoverContentClass,
  popoverKindClass,
  popoverSizeClass,
  type PopoverKind,
  type PopoverSize,
} from "./popupStyles";
import { cn } from "../classNames";
import { IconButton } from "../controls/IconButton";
import { Text } from "../display/Text";

/*
 * The popover language. A popover is one of three kinds at one of the shared widths, and its
 * parts come from here, so no call site picks a width, padding, radius or type size:
 *
 * ```tsx
 * <PopoverContent size="sm">                      // a panel, 12px in
 *   <PopoverHeader title="Welcome tour" />        // the title and a close button
 *   <PopoverText>A short walk through what's here.</PopoverText>
 *   <PopoverActions><Button variant="secondary">Replay tour</Button></PopoverActions>
 * </PopoverContent>
 *
 * <PopoverContent kind="flush">                   // a picker: search on top, rows under it
 *   <PickerSearch aria-label="Search branches" placeholder="Search branches" … />
 *   <PickerList aria-label="Branches">…</PickerList>
 * </PopoverContent>
 * ```
 */

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverClose = PopoverPrimitive.Close;

type PopoverContentProps = Omit<
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>,
  "className"
> & {
  /** sm 256, md 288 (the default), lg 320, or the trigger's own width. */
  size?: PopoverSize;
  /** What it holds: a `panel` (the default), menu-like rows (`list`), or edge to edge (`flush`). */
  kind?: PopoverKind;
};

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(
  (
    {
      size = "md",
      kind = "panel",
      align = "center",
      side,
      sideOffset = 4,
      forceMount,
      children,
      ...props
    },
    ref,
  ) => {
    const placement = useOverlaySide();
    return (
      <PopoverPrimitive.Portal forceMount={forceMount}>
        <PopoverPrimitive.Content
          ref={ref}
          forceMount={forceMount}
          data-slot="popover-content"
          data-kind={kind}
          align={align}
          side={side ?? placement}
          sideOffset={sideOffset}
          className={cn(
            popoverContentClass,
            "max-w-[calc(100vw-1rem)]",
            popoverSizeClass[size],
            popoverKindClass[kind],
          )}
          {...props}
        >
          <OutOfRow>{children}</OutOfRow>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    );
  },
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

/**
 * A panel's first row: its title, a muted detail at the end (a count, a total), and the button
 * that closes it. Leave `close` off only where the panel closes itself as you act in it.
 */
function PopoverHeader(props: {
  title: React.ReactNode;
  detail?: React.ReactNode;
  close?: boolean;
}) {
  return (
    <div data-slot="popover-header" className="flex min-h-6 min-w-0 items-center gap-2">
      <Text size="control" weight="semibold" tone="default" className="min-w-0 flex-1">
        {props.title}
      </Text>
      {props.detail ? (
        <Text size="meta" tone="muted" className="shrink-0 tabular-nums">
          {props.detail}
        </Text>
      ) : null}
      {props.close === false ? null : (
        <PopoverClose asChild>
          <IconButton size="sm" label="Close">
            <X />
          </IconButton>
        </PopoverClose>
      )}
    </div>
  );
}

/** A panel's line about itself, muted, wrapping. */
function PopoverText(props: { children: React.ReactNode }) {
  return (
    <Text size="control" tone="muted" wrap>
      {props.children}
    </Text>
  );
}

/**
 * A panel's own content between its line and its actions (a field, a list of rows, a meter),
 * set a step apart from the text above it.
 */
function PopoverBody({
  children,
  ...props
}: {
  children: React.ReactNode;
  "aria-label"?: string;
  role?: string;
}) {
  return (
    <div data-slot="popover-body" className="mt-2 grid min-w-0 gap-2" {...props}>
      {children}
    </div>
  );
}

/** A panel's buttons, at its end on the right: quiet ones first, the action last. */
function PopoverActions(props: { children: React.ReactNode }) {
  return (
    <div data-slot="popover-actions" className="mt-2 flex items-center justify-end gap-1">
      {props.children}
    </div>
  );
}

/** A picker's search: the popover's top row, a line under it. Pair with `kind="flush"`. */
const PickerSearch = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentPropsWithoutRef<"input">, "className" | "type"> & { "aria-label": string }
>((props, ref) => (
  <div data-slot="picker-search" className={pickerSearchRowClass}>
    <Search aria-hidden className="size-4 shrink-0 text-cream-muted" />
    <input ref={ref} type="text" className={pickerSearchInputClass} {...props} />
  </div>
));
PickerSearch.displayName = "PickerSearch";

/** A picker's rows under its search, or a flush popover's list: 4px in, scrolling. */
const PickerList = React.forwardRef<
  HTMLDivElement,
  Omit<React.ComponentPropsWithoutRef<"div">, "className">
>((props, ref) => (
  <div
    ref={ref}
    data-slot="picker-list"
    className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto p-1"
    {...props}
  />
));
PickerList.displayName = "PickerList";

export {
  PickerList,
  PickerSearch,
  Popover,
  PopoverActions,
  PopoverAnchor,
  PopoverBody,
  PopoverClose,
  PopoverContent,
  PopoverHeader,
  PopoverText,
  PopoverTrigger,
};
