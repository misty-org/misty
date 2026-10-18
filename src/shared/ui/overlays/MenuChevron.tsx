import { ChevronDown } from "lucide-react";
import { cn } from "../utils";

/**
 * The chevron on anything that opens a menu or popover. It turns over while its trigger is open
 * (the trigger carries `data-state="open"`), so every dropdown moves the same way.
 */
export function MenuChevron({ className }: { className?: string }) {
  return (
    <ChevronDown aria-hidden className={cn("misty-menu-chevron size-3.5 shrink-0", className)} />
  );
}
