import { Button, IconButton, Input } from "@/shared/ui";
import { PlugZap, Plus, RefreshCw, Search, X } from "lucide-react";
import { useState } from "react";

const topBarClass =
  "flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-charcoal-border bg-charcoal-bg px-3 py-1.5";

export function NotesTopBar(props: NotesTopBarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const showSearch = searchOpen || Boolean(props.query);

  return (
    <header className={topBarClass}>
      <h1 className="m-0 min-w-0 shrink truncate text-sm font-semibold">
        {props.noteTitle ? `Journal - ${props.noteTitle}` : "Journal"}
      </h1>

      <div className="ml-auto flex items-center gap-3">
        {props.onSync ? (
          <Button
            className="size-8"
            size="icon"
            variant="ghost"
            type="button"
            disabled={props.syncing}
            onClick={props.onSync}
            aria-label="Sync Journal sources"
            title="Sync Journal sources"
          >
            <RefreshCw className={`size-4 ${props.syncing ? "animate-spin" : ""}`} />
          </Button>
        ) : null}
        {props.onIntegrations ? (
          <Button
            className="size-8"
            size="icon"
            variant="ghost"
            type="button"
            onClick={props.onIntegrations}
            aria-label="Manage Journal integrations"
            title="Journal integrations"
          >
            <PlugZap className="size-4" />
          </Button>
        ) : null}
        {showSearch ? (
          <div className="relative w-44">
            <Search
              size={14}
              strokeWidth={2}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-cream-muted"
            />
            <Input
              autoFocus
              value={props.query}
              onChange={(event) => props.onQueryChange(event.target.value)}
              placeholder="Search notes, tags, and Spaces"
              aria-label="Search notes"
              className="h-8 rounded-md border-charcoal-border/70 bg-charcoal-card pl-8 pr-8 text-[13px] shadow-none"
              onBlur={() => {
                if (!props.query) setSearchOpen(false);
              }}
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
        ) : (
          <Button
            className="size-8"
            size="icon"
            variant="ghost"
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search notes"
          >
            <Search className="size-4" />
          </Button>
        )}

        <Button
          type="button"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={props.onNewNote}
          disabled={props.readOnly}
          title={props.readOnly ? "Reconnect to create a note" : undefined}
        >
          <Plus size={14} strokeWidth={2.2} />
          New note
        </Button>
      </div>
    </header>
  );
}

export interface NotesTopBarProps {
  query: string;
  noteTitle?: string;
  readOnly?: boolean;
  onQueryChange: (query: string) => void;
  onNewNote: () => void;
  onIntegrations?: () => void;
  onSync?: () => void;
  syncing?: boolean;
}
