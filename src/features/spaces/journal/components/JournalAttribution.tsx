import { cn, Surface, Text } from "@/shared/ui";
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
        "inline-flex shrink-0 rounded-md no-underline focus-visible:outline-none",
        className,
      )}
    >
      <Surface
        as="span"
        tone="card"
        edge="hairline"
        radius="md"
        className="inline-flex h-7 items-center px-2.5 text-2xs"
      >
        <Text bare tone="muted" className="inline-flex items-center gap-1">
          <span>
            Powered by <span className="font-semibold">{technology}</span>
          </span>
          <ExternalLink aria-hidden="true" />
        </Text>
      </Surface>
    </a>
  );
}
