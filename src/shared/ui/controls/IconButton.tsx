import * as React from "react";
import { useOnRow } from "./RowContext";

import { cn } from "../classNames";
import { Spinner } from "../feedback/Spinner";
import { Tooltip, type TooltipSide } from "../overlays/Tooltip";
import { Button, type ButtonLook, type ButtonProps } from "./Button";

/** sm 24 for inline closers in tabs and every button on a row (RowTools sets it), md 32 (the
 * default) for toolbars. */
export type IconButtonSize = "sm" | "md";

/** Button's roles, plus `overlay` for controls drawn over images, video and the Studio only. */
export type IconButtonVariant = ButtonLook;

const sizeClass: Record<IconButtonSize, string> = {
  // Width and height stay separate classes so a caller's `w-auto` replaces the width outright
  // instead of racing `size-*` in the stylesheet.
  sm: "h-6 w-6",
  md: "h-8 w-8",
};

/**
 * The one icon-only button. Its label is its accessible name and its Tooltip, with the shortcut
 * after it while shortcut hints are on; it never uses the system title. The icon is its child and
 * draws at 16px. With `asChild` it styles its child, such as a router Link.
 */
const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      "aria-label": ariaLabel,
      children,
      className,
      label,
      hint,
      shortcut,
      tooltipSide,
      loading = false,
      size,
      type = "button",
      variant,
      ...props
    },
    ref,
  ) => {
    // On a row every IconButton is the row's size (RowTools), whatever the feature passed.
    const onRow = useOnRow();
    const resolvedSize = onRow ? "sm" : (size ?? "md");
    return (
      <Tooltip content={hint || label} shortcut={shortcut} side={tooltipSide}>
        <Button
          ref={ref}
          type={type}
          variant={variant ?? "quiet"}
          size={resolvedSize}
          aria-label={ariaLabel ?? label}
          aria-busy={loading || undefined}
          className={cn(
            "shrink-0 justify-center gap-0 p-0 shadow-none",
            sizeClass[resolvedSize],
            loading && "pointer-events-none",
            className,
          )}
          {...props}
        >
          {loading ? <Spinner label={false} /> : children}
        </Button>
      </Tooltip>
    );
  },
);
IconButton.displayName = "IconButton";
export { IconButton };

export type IconButtonProps = Omit<
  ButtonProps,
  "size" | "variant" | "icon" | "iconEnd" | "loading" | "title"
> & {
  /** The icon, at 16px. */
  children: React.ReactNode;
  /** What it does, in sentence case: its accessible name and its tooltip. */
  label: string;
  /**
   * The tooltip's text when it says more than the label: what a check does, or why a toggle
   * can't change here. The label stays the accessible name.
   */
  hint?: string;
  /** The command's shortcut as it reads, such as "⌘N", shown after the label while hints are on. */
  shortcut?: string;
  /** Which side of the button the tooltip opens on. Defaults to top, flipping when there's no room. */
  tooltipSide?: TooltipSide;
  /** Defaults to quiet. */
  variant?: IconButtonVariant | null;
  /** Defaults to md (32). */
  size?: IconButtonSize | null;
  /** Working on the click: a spinner replaces the icon and clicks wait. */
  loading?: boolean;
};
