import { Bot, LibraryBig, Paperclip, Users } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  PopoverContent,
} from "@/ui";
import type { ChatComposerSuggestion } from "@/models/types/features/spaces/SpaceChat";

export interface ChatSuggestionPopoverProps {
  listId: string;
  suggestions: ChatComposerSuggestion[];
  activeIndex: number;
  loading: boolean;
  error: string;
  canBrowseLibrary: boolean;
  canUploadAttachments: boolean;
  onHoverIndex: (index: number) => void;
  onSelect: (suggestion: ChatComposerSuggestion) => void;
  onBrowseLibrary: () => void;
  onUploadFiles: () => void;
}

/** The `@` menu: explicit add actions on top, matched Agents/people/items below. */
export function ChatSuggestionPopover(props: ChatSuggestionPopoverProps) {
  const showEmpty = !props.loading && !props.error && props.suggestions.length === 0;

  return (
    <PopoverContent
      side="top"
      align="start"
      sideOffset={10}
      className="w-[min(480px,calc(100vw-32px))] p-0"
      onOpenAutoFocus={(event) => event.preventDefault()}
    >
      <Command shouldFilter={false}>
        <CommandList id={props.listId}>
          <CommandGroup heading="Add to message">
            {props.canBrowseLibrary ? (
              <CommandItem onSelect={props.onBrowseLibrary}>
                <LibraryBig />
                <AddActionLabel title="Browse Library" detail="Select one or more shared items" />
              </CommandItem>
            ) : null}
            {props.canUploadAttachments ? (
              <CommandItem onSelect={props.onUploadFiles}>
                <Paperclip />
                <AddActionLabel title="Upload files" detail="Choose with Misty’s file picker" />
              </CommandItem>
            ) : null}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Suggestions">
            {props.suggestions.map((suggestion, index) => (
              <CommandItem
                id={`${props.listId}-option-${index}`}
                key={`${suggestion.kind}:${suggestion.id}`}
                aria-selected={index === props.activeIndex}
                className={index === props.activeIndex ? "bg-accent" : undefined}
                value={`${suggestion.kind}:${suggestion.id}`}
                onMouseEnter={() => props.onHoverIndex(index)}
                onSelect={() => props.onSelect(suggestion)}
              >
                {suggestion.kind === "member" ? (
                  <Users />
                ) : suggestion.kind === "agent" ? (
                  <Bot />
                ) : (
                  <LibraryBig />
                )}
                <span className="min-w-0">
                  <span className="block truncate">{suggestion.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {suggestion.detail}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
          {showEmpty ? (
            <CommandEmpty>No matching Agents, people, or Library items.</CommandEmpty>
          ) : null}
          {props.loading ? (
            <p className="p-3 text-sm text-muted-foreground">Loading Library…</p>
          ) : null}
          {props.error ? (
            <p className="p-3 text-sm text-destructive">Library: {props.error}</p>
          ) : null}
        </CommandList>
      </Command>
    </PopoverContent>
  );
}

function AddActionLabel({ title, detail }: { title: string; detail: string }) {
  return (
    <span>
      <span className="block">{title}</span>
      <span className="block text-xs text-muted-foreground">{detail}</span>
    </span>
  );
}
