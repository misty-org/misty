import { TooltipProvider } from "@/shared/ui";
import { FileCode2, FolderOpen, MessagesSquare, Notebook, PenTool } from "lucide-react";
import { SpaceSidebarLink } from "./spacePanel/SpaceSidebarLink";

// A Space's primitives, in ⌘1 to ⌘5 order. Management controls sit beside them.
export const spaceSections = [
  { id: "social", label: "Chat", icon: MessagesSquare },
  { id: "notes", label: "Notes", icon: Notebook },
  { id: "drawings", label: "Drawings", icon: PenTool },
  { id: "library", label: "Files", icon: FolderOpen },
  { id: "code", label: "Code", icon: FileCode2 },
] as const;

export function SpaceSectionNavigation({
  spaceId,
  section,
  horizontal,
  iconOnly = false,
  strip = false,
  onNavigate,
}: {
  spaceId: string;
  section: string;
  horizontal?: boolean;
  iconOnly?: boolean;
  /** Equal-width icon cells on one track, above the active tool's own list. */
  strip?: boolean;
  onNavigate?: (path: string) => void;
}) {
  return (
    <TooltipProvider delayDuration={350}>
      <nav
        className={
          strip
            ? "grid min-w-0 auto-cols-fr grid-flow-col gap-0.5 rounded-lg bg-charcoal-card p-0.5"
            : horizontal
              ? "flex min-w-0 items-center gap-1 overflow-x-auto"
              : "grid min-w-0 gap-1"
        }
        aria-label="Space sections"
      >
        {spaceSections.map(({ id, label, icon: Icon }) => (
          <SpaceSidebarLink
            key={id}
            horizontal={horizontal}
            iconOnly={iconOnly}
            strip={strip}
            active={section === id}
            icon={Icon}
            label={label}
            to={`/spaces/${encodeURIComponent(spaceId)}/${id}`}
            onNavigate={onNavigate}
          />
        ))}
      </nav>
    </TooltipProvider>
  );
}
