import type { NotesPanelSidebarProps } from "@/models/interfaces/features/notes/SpaceNotes";
export type { NotesPanelSidebarProps } from "@/models/interfaces/features/notes/SpaceNotes";
import { Clock, FileText, Files, Plug, Star, Unlink } from "lucide-react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { Button, Separator, cn } from "@/ui";
import { useNotesStore } from "@/stores/notes";
import type { NoteGroupId } from "@/models/types/features/notes/types";
import { groupCounts, noteGroups } from "@/features/notes/noteFilters";
import { SpaceSidebarSection } from "@/features/spaces/components/SpaceSidebarSection";
import { NoteSourceIcon, providerStatusPresentation } from "./NoteSourceBadge";

const groupIcons: Record<NoteGroupId, typeof Files> = {
  space: FileText,
  all: Files,
  misty: FileText,
  notion: FileText,
  unlinked: Unlink,
  recent: Clock,
  favorites: Star,
};

function linkClass(active: boolean) {
  return cn(
    "flex h-9 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-sm no-underline outline-none",
    "transition-colors focus-visible:ring-1 focus-visible:ring-sidebar-ring",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-sidebar-foreground hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
  );
}

/**
 * Rendered into the Space shell's contextual sidebar, alongside the Chat and
 * Library panels — Notes gets no sidebar of its own.
 */
export function NotesPanelSidebar(props: NotesPanelSidebarProps) {
  const { notes, connectorRevision, registry, setIntegrationsOpen } = useNotesStore(
    useShallow((state) => ({
      notes: state.notes,
      connectorRevision: state.connectorRevision,
      registry: state.registry,
      setIntegrationsOpen: state.setIntegrationsOpen,
    })),
  );

  const counts = groupCounts(notes, Date.now(), props.spaceId);
  const connectors = registry.list();
  void connectorRevision;

  return (
    <div className="grid gap-3">
      <SpaceSidebarSection title="Notes">
        <nav className="grid gap-1" aria-label="Note groups">
          {noteGroups.map((group) => {
            const Icon = groupIcons[group.id];
            const active = props.activeGroup === group.id;
            return (
              <Link
                key={group.id}
                className={linkClass(active)}
                aria-current={active ? "page" : undefined}
                to={`/spaces/${encodeURIComponent(props.spaceId)}/notes?group=${group.id}`}
              >
                <span className="grid size-5 shrink-0 place-items-center text-muted-foreground">
                  {group.source ? (
                    <NoteSourceIcon source={group.source} size={14} />
                  ) : (
                    <Icon size={14} />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{group.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">
                  {counts[group.id] ?? 0}
                </span>
              </Link>
            );
          })}
        </nav>
      </SpaceSidebarSection>

      <Separator className="bg-sidebar-border" />

      <SpaceSidebarSection title="Sources">
        <div className="grid gap-1">
          {connectors.map((connector) => {
            const { tone, label } = providerStatusPresentation[connector.status()];
            return (
              <div
                key={connector.id}
                className="flex h-8 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-sm"
                title={`${connector.name} — ${label}`}
              >
                <span className="grid size-5 shrink-0 place-items-center">
                  <NoteSourceIcon source={connector.source} size={14} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sidebar-foreground">
                  {connector.name}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    tone === "success" && "bg-emerald-500",
                    tone === "info" && "animate-pulse bg-primary",
                    tone === "warning" && "bg-amber-500",
                    tone === "neutral" && "bg-muted-foreground/40",
                  )}
                />
                <span className="sr-only">{label}</span>
              </div>
            );
          })}

          <Button
            type="button"
            variant="ghost"
            className={cn(
              "mt-1 h-9 w-full justify-start gap-2.5 px-2.5 text-sm font-medium",
              "text-muted-foreground hover:bg-sidebar-accent/65",
              "hover:text-sidebar-accent-foreground",
            )}
            onClick={() => setIntegrationsOpen(true)}
          >
            <span className="grid size-5 shrink-0 place-items-center">
              <Plug size={14} />
            </span>
            Manage sources
          </Button>
        </div>
      </SpaceSidebarSection>
    </div>
  );
}
