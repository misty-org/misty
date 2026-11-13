import type { ChatComposerSuggestion } from "../../api/dto/space-chat";
import { SystemErrorNotice } from "@/shared/platform/systemErrors";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  PopoverContent,
  SkeletonList,
} from "@/shared/ui";
import { LibraryBig, Paperclip, Users } from "lucide-react";
import { AgentMark } from "@/features/agents";
import { useState, type ComponentPropsWithoutRef } from "react";

interface ChatSuggestionPopoverProps {
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
  onInteractOutside?: ComponentPropsWithoutRef<typeof PopoverContent>["onInteractOutside"];
}

const suggestionValue = (suggestion: ChatComposerSuggestion) =>
  `${suggestion.kind}:${suggestion.id}`;

/** The `@` menu: explicit add actions on top, matched Agents/people/items below. */
export function ChatSuggestionPopover(props: ChatSuggestionPopoverProps) {
  const showEmpty = !props.loading && !props.error && props.suggestions.length === 0;
  // The highlighted row is the composer's active suggestion, until the pointer moves onto one of
  // the add actions; a new active suggestion (arrow keys, hover) takes the highlight back.
  const active = props.suggestions[props.activeIndex];
  const activeValue = active ? suggestionValue(active) : "";
  const [pointer, setPointer] = useState<{ value: string; over: string } | null>(null);
  const highlighted = pointer && pointer.over === activeValue ? pointer.value : activeValue;

  return (
    <PopoverContent
      side="top"
      align="start"
      sideOffset={10}
      size="lg"
      kind="flush"
      onOpenAutoFocus={(event) => event.preventDefault()}
      onInteractOutside={props.onInteractOutside}
    >
      <Command
        shouldFilter={false}
        value={highlighted}
        onValueChange={(value) => {
          const index = props.suggestions.findIndex(
            (suggestion) => suggestionValue(suggestion) === value,
          );
          if (index >= 0) props.onHoverIndex(index);
          else setPointer({ value, over: activeValue });
        }}
      >
        <CommandList id={props.listId}>
          <CommandGroup heading="Add to message">
            {props.canBrowseLibrary ? (
              <CommandItem
                icon={LibraryBig}
                label="Browse Library"
                description="Select one or more shared items"
                onSelect={props.onBrowseLibrary}
              />
            ) : null}
            {props.canUploadAttachments ? (
              <CommandItem
                icon={Paperclip}
                label="Upload files"
                description="Choose with Misty’s file picker"
                onSelect={props.onUploadFiles}
              />
            ) : null}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Suggestions">
            {props.suggestions.map((suggestion, index) => (
              <CommandItem
                id={`${props.listId}-option-${index}`}
                key={`${suggestion.kind}:${suggestion.id}`}
                aria-selected={index === props.activeIndex}
                value={suggestionValue(suggestion)}
                onMouseEnter={() => props.onHoverIndex(index)}
                onSelect={() => props.onSelect(suggestion)}
                icon={
                  suggestion.kind === "member" ? (
                    Users
                  ) : suggestion.kind === "agent" ? (
                    <AgentMark agentId={suggestion.id} />
                  ) : (
                    LibraryBig
                  )
                }
                label={suggestion.label}
                description={suggestion.detail}
              />
            ))}
          </CommandGroup>
          {showEmpty ? (
            <CommandEmpty>No matching Agents, people, or Library items.</CommandEmpty>
          ) : null}
          {props.loading ? (
            <SkeletonList
              label="Library suggestions"
              rows={3}
              leading="icon"
              lines={2}
              className="p-2"
              rowClassName="gap-2 px-2 py-1.5"
            />
          ) : null}
          {props.error ? (
            <SystemErrorNotice
              error={props.error}
              scope="social:composer:library"
              title="Library suggestions could not be loaded"
            />
          ) : null}
        </CommandList>
      </Command>
    </PopoverContent>
  );
}
