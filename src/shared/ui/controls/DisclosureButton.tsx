import { ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "../classNames";
import { Button, type ButtonProps } from "./Button";

export type DisclosureButtonProps = Omit<ButtonProps, "variant" | "icon" | "iconEnd"> & {
  /** Whether what it shows is open: the chevron turns up. */
  open: boolean;
};

/**
 * Shows or hides more of a list under it, such as More engines: a quiet, muted button at the
 * start of its row with a chevron that turns as it opens. The caller mounts what it shows.
 *
 * ```tsx
 * <DisclosureButton open={more} onClick={() => setMore((open) => !open)}>
 *   {more ? "Fewer engines" : "More engines"}
 * </DisclosureButton>
 * ```
 */
const DisclosureButton = React.forwardRef<HTMLButtonElement, DisclosureButtonProps>(
  ({ open, className, children, ...props }, ref) => (
    <Button
      ref={ref}
      variant="quiet"
      aria-expanded={open}
      className={cn("justify-self-start text-cream-muted", className)}
      {...props}
    >
      <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
      {children}
    </Button>
  ),
);
DisclosureButton.displayName = "DisclosureButton";

export { DisclosureButton };
