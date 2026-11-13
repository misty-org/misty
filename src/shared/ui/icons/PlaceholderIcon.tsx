import type { LucideIcon } from "lucide-react";
import { cn } from "../classNames";

/**
 * The one icon drawn larger than a glyph: what stands in for content that isn't there or can't be
 * shown, such as a file's thumbnail, a drop zone or an empty list. Every other icon in Misty draws
 * at the glyph size (16px, styles/App.css) and takes no size of its own.
 */
export function PlaceholderIcon({
  icon: Icon,
  className,
}: {
  icon: LucideIcon;
  /** Placement and color only; the size is fixed. */
  className?: string;
}) {
  return <Icon aria-hidden="true" className={cn("size-8 text-cream-muted", className)} />;
}
