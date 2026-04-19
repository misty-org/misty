import { ExternalLink } from "lucide-react";
import { handleExternalLinkClick } from "@/platform/openExternalLink";
import { cn } from "@/ui";

export function JournalAttribution({
  technology,
  href,
  className,
}: {
  technology: "BlockNote" | "Excalidraw";
  href: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={handleExternalLinkClick(href)}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-border/60 bg-muted/35 px-2.5 text-[11px] text-muted-foreground no-underline transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      aria-label={`Misty Journal is powered by ${technology}. Visit ${technology}.`}
      title={`Misty Journal is powered by ${technology}`}
    >
      <span className="hidden text-foreground/70 min-[1180px]:inline">Misty Journal</span>
      <span className="hidden min-[1180px]:inline" aria-hidden="true">
        ·
      </span>
      <span>
        powered by <span className="font-semibold text-foreground/80">{technology}</span>
      </span>
      <ExternalLink size={10} strokeWidth={2} aria-hidden="true" />
    </a>
  );
}
