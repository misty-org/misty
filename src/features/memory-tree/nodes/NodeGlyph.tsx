import { cn } from "@/shared/ui";
import { SavedWebsiteIcon } from "@/features/browser-sync/SavedWebsiteIcon";
import { type MemoryNode } from "../model";
import { nodeVisual } from "./nodeVisual";

/** The address whose favicon stands for a node: a page's own, or a site group's host. */
function faviconAddress(node: MemoryNode | null): string | null {
  if (!node || node.source !== "page") return null;
  if (node.type === "moment") return node.url || null;
  if (node.type === "group" && node.label.includes(".")) return `https://${node.label}`;
  return null;
}

/**
 * A node's glyph: the site's favicon for pages and sites (the globe if it can't load), and the
 * tone-colored memory glyph for everything else.
 */
export function NodeGlyph({ node, className }: { node: MemoryNode | null; className?: string }) {
  const address = faviconAddress(node);
  if (address)
    return (
      <span className={cn("flex size-[18px] shrink-0 items-center justify-center", className)}>
        <SavedWebsiteIcon url={address} />
      </span>
    );
  const { Icon, toneClass } = nodeVisual(node);
  return <Icon className={cn("size-[18px] shrink-0", toneClass, className)} aria-hidden="true" />;
}
