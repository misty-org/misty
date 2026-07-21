import type { NotesTopBarProps } from "@/models/interfaces/features/notes/components/NotesTopBar";
export type { NotesTopBarProps } from "@/models/interfaces/features/notes/components/NotesTopBar";
import { PanelRight, Plus, RefreshCw, Search, X } from "lucide-react";
import type { NoteGroupId } from "@/models/types/features/notes/types";
import {
  Button,
  IconButton,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from "@/ui";
import { noteGroups, relativeTime } from "@/features/notes/noteFilters";

const topBarClass = "flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card/60 px-3";

export function NotesTopBar(props: NotesTopBarProps) {
  return (
    <header className={topBarClass}>
      <div className="relative min-w-0 flex-1 max-w-[420px]">
        <Search
          size={14}
          strokeWidth={2}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder="Search notes, tags, and Spaces"
          aria-label="Search notes"
          className="h-8 pl-8 pr-8 text-[13px]"
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

      <Select
        value={props.activeGroup}
        onValueChange={(value) => props.onSelectGroup(value as NoteGroupId)}
      >
        <SelectTrigger className="h-8 w-[160px] text-[13px]" aria-label="Filter by source">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {noteGroups.map((group) => (
            <SelectItem key={group.id} value={group.id}>
              {group.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="ml-auto flex items-center gap-2">
        <span className="hidden text-[11px] text-muted-foreground sm:inline">
          {props.syncing
            ? "Syncing…"
            : props.lastSyncedAt
              ? `Synced ${relativeTime(props.lastSyncedAt)}`
              : "Not synced"}
        </span>
        <IconButton title="Sync all sources" disabled={props.syncing} onClick={props.onSync}>
          <RefreshCw size={14} className={cn(props.syncing && "animate-spin")} />
        </IconButton>
        <IconButton
          title={props.contextPanelOpen ? "Hide details" : "Show details"}
          onClick={props.onToggleContextPanel}
        >
          <PanelRight size={14} className={cn(props.contextPanelOpen && "text-foreground")} />
        </IconButton>
        <Button type="button" size="sm" className="h-8 gap-1.5" onClick={props.onNewNote}>
          <Plus size={14} strokeWidth={2.2} />
          New note
        </Button>
      </div>
    </header>
  );
}
