import * as React from "react";
import { Button, type ButtonProps } from "./Button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../overlays/Tooltip";
import { cn } from "../utils";

const iconButtonSizes = {
  xs: "size-6 [&_svg:not([class*='size-'])]:size-3.5",
  sm: "size-[30px]",
  md: "size-9",
  lg: "size-10",
} as const;

/** Glyph geometry for icons inside toolbar-sized icon buttons. */
export const toolbarIconProps = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

/**
 * The one icon-only button. Defaults to the browser chrome's toolbar look at 30px;
 * `label` is required and doubles as the tooltip unless `tooltip={false}`.
 */
const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      "aria-label": ariaLabel,
      children,
      className,
      label,
      size = "sm",
      tooltip = label,
      type = "button",
      variant = "toolbar",
      ...props
    },
    ref,
  ) => {
    const button = (
      <Button
        ref={ref}
        type={type}
        variant={variant}
        size="none"
        aria-label={ariaLabel ?? label}
        title={tooltip === false ? label : undefined}
        className={cn("shrink-0 p-0 shadow-none", iconButtonSizes[size], className)}
        {...props}
      >
        {children}
      </Button>
    );

    if (tooltip === false) return button;

    return (
      <TooltipProvider delayDuration={450}>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  },
);
IconButton.displayName = "IconButton";
export { IconButton };

export type IconButtonProps = Omit<ButtonProps, "asChild" | "size"> & {
  children: React.ReactNode;
  label: string;
  tooltip?: string | false;
  size?: keyof typeof iconButtonSizes;
};
