import { cn } from "@/shared/ui";
import { ExternalLink } from "lucide-react";

export function JournalAttribution({
  technology,
  href,
  className,
}: {
  technology: "Excalidraw";
  href: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-charcoal-border/60",
        "bg-charcoal-card px-2.5 text-2xs text-cream-muted no-underline transition-colors",
        "hover:bg-charcoal-card hover:text-cream focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-charcoal-active",
        className,
      )}
    >
      <span>
        Powered by <span className="font-semibold text-cream/80">{technology}</span>
      </span>
      <ExternalLink size={10} strokeWidth={2} aria-hidden="true" />
    </a>
  );
}
