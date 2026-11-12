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
import { Bot, LibraryBig, Paperclip, Users } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";

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
      onInteractOutside={props.onInteractOutside}
    >
      <Command shouldFilter={false}>
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
                className={index === props.activeIndex ? "bg-charcoal-hover" : undefined}
                value={`${suggestion.kind}:${suggestion.id}`}
                onMouseEnter={() => props.onHoverIndex(index)}
                onSelect={() => props.onSelect(suggestion)}
                icon={
                  suggestion.kind === "member"
                    ? Users
                    : suggestion.kind === "agent"
                      ? Bot
                      : LibraryBig
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
              rowClassName="px-2"
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
