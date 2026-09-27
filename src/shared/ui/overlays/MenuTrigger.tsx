import { ChevronDown } from "lucide-react";
import * as React from "react";
import { Button, type ButtonProps } from "../controls/Button";
import { IconButton } from "../controls/IconButton";
import { cn } from "../utils";
import { DropdownMenuTrigger } from "./DropdownMenu";

type MenuTriggerProps = Omit<ButtonProps, "asChild" | "size" | "children"> & {
  /** Accessible name; also the visible text unless `value` is given. */
  label: string;
  icon?: React.ReactNode;
  /** Current selection shown in place of the label, e.g. a picked model. */
  value?: React.ReactNode;
  /** Icon-only triggers are toolbar icon buttons and never show a chevron. */
  iconOnly?: boolean;
  tooltip?: string | false;
};

/**
 * The button that opens a DropdownMenu. Labeled triggers always end in a chevron that
 * flips while open; icon-only triggers never have one. Features never draw their own.
 */
const MenuTrigger = React.forwardRef<HTMLButtonElement, MenuTriggerProps>(
  ({ label, icon, value, iconOnly = false, tooltip, variant, className, ...props }, ref) => {
    if (iconOnly) {
      return (
        <DropdownMenuTrigger asChild>
          <IconButton
            ref={ref}
            label={label}
            tooltip={tooltip ?? false}
            variant={variant ?? "toolbar"}
            className={className}
            {...props}
          >
            {icon}
          </IconButton>
        </DropdownMenuTrigger>
      );
    }
    return (
      <DropdownMenuTrigger asChild>
        <Button
          ref={ref}
          type="button"
          variant={variant ?? "ghost"}
          size="sm"
          aria-label={value === undefined ? undefined : label}
          className={cn("min-w-0 gap-1.5", className)}
          {...props}
        >
          {icon}
          <span className="min-w-0 truncate">{value ?? label}</span>
          <ChevronDown
            aria-hidden
            className="size-3.5 shrink-0 text-cream-muted transition-transform duration-150 group-data-[state=open]/button:rotate-180"
          />
        </Button>
      </DropdownMenuTrigger>
    );
  },
);
MenuTrigger.displayName = "MenuTrigger";

export { MenuTrigger };
export type { MenuTriggerProps };
