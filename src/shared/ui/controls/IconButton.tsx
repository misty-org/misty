import * as React from "react";
import { Button, type ButtonProps } from "./Button";
import { cn } from "../utils";

const iconButtonSizes = {
  // Inline closers inside tabs and menu rows.
  // Width and height stay separate classes so a caller's `w-auto` replaces the width
  // outright instead of racing `size-*` in the stylesheet.
  "2xs": "h-5 w-5 [&_svg:not([class*='size-'])]:size-3",
  xs: "h-6 w-6 [&_svg:not([class*='size-'])]:size-3.5",
  sm: "h-8 w-8",
  md: "h-9 w-9",
  lg: "h-10 w-10",
} as const;

/** Glyph geometry for icons inside toolbar-sized icon buttons. */
export const toolbarIconProps = { size: 18, strokeWidth: 1.75, "aria-hidden": true } as const;

/**
 * The one icon-only button. Defaults to the browser chrome's toolbar look at 32px;
 * `label` is required and doubles as the native title unless `tooltip` says otherwise. With `asChild` it
 * styles its child, such as a router Link. `shape="round"` is for tab closers and media controls.
 */
const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      "aria-label": ariaLabel,
      children,
      className,
      label,
      shape = "square",
      size = "sm",
      tooltip = label,
      type = "button",
      variant = "toolbar",
      ...props
    },
    ref,
  ) => {
    // The tooltip is the browser's own title, so there is nothing to wrap.
    return (
      <Button
        ref={ref}
        type={type}
        variant={variant}
        size="none"
        aria-label={ariaLabel ?? label}
        data-icon-size={size}
        title={tooltip === false ? label : tooltip}
        className={cn(
          "shrink-0 p-0 shadow-none",
          iconButtonSizes[size],
          shape === "round" && "rounded-full",
          className,
        )}
        {...props}
      >
        {children}
      </Button>
    );
  },
);
IconButton.displayName = "IconButton";
export { IconButton };

export type IconButtonProps = Omit<ButtonProps, "size"> & {
  children: React.ReactNode;
  label: string;
  tooltip?: string | false;
  size?: keyof typeof iconButtonSizes;
  shape?: "square" | "round";
};
