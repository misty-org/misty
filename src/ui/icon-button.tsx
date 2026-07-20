import type { IconButtonProps } from "@/models/types/ui/icon-button";
export type { IconButtonProps } from "@/models/types/ui/icon-button";
import * as React from "react";
import { Button } from "@/ui";
import type { ButtonProps } from "@/models/interfaces/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/ui";
import { cn } from "@/ui";

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      "aria-label": ariaLabel,
      children,
      className,
      label,
      size = "default",
      tooltip = label,
      type = "button",
      variant = "ghost",
      ...props
    },
    ref,
  ) => {
    const button = (
      <Button
        ref={ref}
        type={type}
        variant={variant}
        size="icon"
        aria-label={ariaLabel ?? label}
        title={tooltip === false ? label : undefined}
        className={cn(
          "shrink-0 shadow-none",
          size === "sm" && "size-8",
          size === "default" && "size-9",
          size === "lg" && "size-10",
          className,
        )}
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
