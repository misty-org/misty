import { PanelRight, Plus, Search, X } from "lucide-react";
import { Button, IconButton, Input } from "@/ui";
import {
  SpacesBottomBarActionsPortal,
  SpacesBottomBarToggle,
} from "@/features/spaces/components/SpacesBottomBar";

const topBarClass =
  "flex h-11 shrink-0 items-center gap-2 border-b border-charcoal-border bg-charcoal-bg px-3";

export function NotesTopBar(props: NotesTopBarProps) {
  return (
    <>
      <header className={topBarClass}>
        <div className="relative min-w-[180px] flex-1">
          <Search
            size={14}
            strokeWidth={2}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-cream-muted"
          />
          <Input
            value={props.query}
            onChange={(event) => props.onQueryChange(event.target.value)}
            placeholder="Search notes, tags, and Spaces"
            aria-label="Search notes"
            className="h-8 rounded-md border-charcoal-border/70 bg-charcoal-card pl-8 pr-8 text-[13px] shadow-none"
          />
          {props.query ? (
            <IconButton
              title="Clear search"
              className="absolute right-1 top-1/2 size-6 -translate-y-1/2"
              onClick={() => props.onQueryChange("")}
            >
              <X size={13} />
            </IconButton>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5"
            onClick={props.onNewNote}
            disabled={props.readOnly}
            title={props.readOnly ? "Reconnect to create a note" : undefined}
          >
            <Plus size={14} strokeWidth={2.2} />
            New note
          </Button>
        </div>
      </header>

      <SpacesBottomBarActionsPortal>
        {props.contextPanelAvailable ? (
          <SpacesBottomBarToggle
            pressed={props.contextPanelOpen}
            title={props.contextPanelOpen ? "Hide details" : "Show details"}
            onClick={props.onToggleContextPanel}
          >
            <PanelRight size={15} />
          </SpacesBottomBarToggle>
        ) : null}
      </SpacesBottomBarActionsPortal>
    </>
  );
}

export interface NotesTopBarProps {
  query: string;
  contextPanelOpen: boolean;
  contextPanelAvailable?: boolean;
  readOnly?: boolean;
  onQueryChange: (query: string) => void;
  onNewNote: () => void;
  onToggleContextPanel: () => void;
}
