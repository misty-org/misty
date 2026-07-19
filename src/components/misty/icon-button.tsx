import * as React from "react"

import { Button, type ButtonProps } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type IconButtonProps = Omit<ButtonProps, "asChild" | "size"> & {
  children: React.ReactNode
  label: string
  tooltip?: string | false
  size?: "sm" | "default" | "lg"
}

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
    )

    if (tooltip === false) return button

    return (
      <TooltipProvider delayDuration={450}>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  },
)
IconButton.displayName = "IconButton"

export { IconButton, type IconButtonProps }
