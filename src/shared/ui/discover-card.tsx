import type { ComponentProps } from "react";
import { cn } from "./utils";

/** The raised tile used by Discover-style catalogs (Library collections, browser extensions). */
export function DiscoverCard({ className, ...props }: ComponentProps<"article">) {
  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-xl bg-charcoal-card shadow-xs inset-ring-1 inset-ring-cream/10",
        className,
      )}
      {...props}
    />
  );
}
