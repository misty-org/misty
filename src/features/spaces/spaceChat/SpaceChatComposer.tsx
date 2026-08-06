import { useId, type FormEvent, type KeyboardEvent } from "react";
import { Plus, Send } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
  Popover,
  PopoverAnchor,
} from "@/ui";
import type { MistyPickerSource } from "@/models/interfaces/features/picker/MistyPicker";
import { ChatAttachmentChips } from "./ChatAttachmentChips";
import { ChatReplyBanner } from "./ChatReplyBanner";
import { ChatSuggestionPopover } from "./ChatSuggestionPopover";
import type { SpaceChatDraft } from "./useSpaceChatDraft";
import type { ChatSuggestionsState } from "./useChatSuggestions";
import type { useComposerInput } from "./useComposerInput";

const MAX_MESSAGE_LENGTH = 4000;

export interface SpaceChatComposerProps {
  draft: SpaceChatDraft;
  suggestions: ChatSuggestionsState;
  input: ReturnType<typeof useComposerInput>;
  isConversation: boolean;
  sending: boolean;
  canUploadAttachments: boolean;
  canBrowseLibrary: boolean;
  replyToSenderName: string;
  onSubmit: (event: FormEvent) => void;
  onOpenPicker: (source: MistyPickerSource) => void;
}

export function SpaceChatComposer(props: SpaceChatComposerProps) {
  const { draft, suggestions, input } = props;
  const listId = useId();

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.open) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        suggestions.setActiveIndex((current) =>
          Math.min(current + 1, Math.max(0, suggestions.suggestions.length - 1)),
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        suggestions.setActiveIndex((current) => Math.max(0, current - 1));
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        suggestions.setOpen(false);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const selected = suggestions.suggestions[suggestions.activeIndex];
        if (selected) input.select(selected);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <div className="shrink-0 bg-charcoal-bg px-[clamp(18px,4vw,56px)] pb-5 pt-2">
      <form className="mx-auto max-w-4xl" onSubmit={props.onSubmit}>
        <InputGroup className="rounded-xl border border-charcoal-border bg-charcoal-card shadow-none">
          {draft.replyToMessageId ? (
            <ChatReplyBanner
              senderName={props.replyToSenderName}
              onCancel={() => draft.setReplyToMessageId("")}
            />
          ) : null}

          <Popover open={suggestions.open} onOpenChange={suggestions.setOpen}>
            <PopoverAnchor asChild>
              <InputGroupTextarea
                className="min-h-20 px-4 py-3.5"
                aria-label={props.isConversation ? "Message this group" : "Message this Space"}
                aria-autocomplete="list"
                aria-controls={suggestions.open ? listId : undefined}
                aria-expanded={suggestions.open}
                aria-haspopup="listbox"
                aria-activedescendant={
                  suggestions.open && suggestions.suggestions[suggestions.activeIndex]
                    ? `${listId}-option-${suggestions.activeIndex}`
                    : undefined
                }
                role="combobox"
                wrap="soft"
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder="Write a message… Use @ to mention or add"
                value={draft.text}
                onChange={(event) => input.onChange(event.target.value)}
                onKeyDown={onKeyDown}
              />
            </PopoverAnchor>
            <ChatSuggestionPopover
              listId={listId}
              suggestions={suggestions.suggestions}
              activeIndex={suggestions.activeIndex}
              loading={suggestions.loading}
              error={suggestions.error}
              canBrowseLibrary={props.canBrowseLibrary}
              canUploadAttachments={props.canUploadAttachments}
              onHoverIndex={suggestions.setActiveIndex}
              onSelect={input.select}
              onBrowseLibrary={() => {
                suggestions.setOpen(false);
                props.onOpenPicker("library");
              }}
              onUploadFiles={() => {
                suggestions.setOpen(false);
                props.onOpenPicker("files");
              }}
            />
          </Popover>

          <ChatAttachmentChips
            pendingAttachments={draft.pendingAttachments}
            selectedLibraryIds={draft.selectedLibraryIds}
            libraryItems={suggestions.libraryItems}
            onRemoveAttachment={(id) =>
              draft.setPendingAttachments((current) => current.filter((item) => item.id !== id))
            }
            onRemoveLibraryItem={(id) =>
              draft.setSelectedLibraryIds((current) => current.filter((item) => item !== id))
            }
          />

          <InputGroupAddon
            align="block-end"
            className="min-h-11 border-t border-charcoal-border/60 px-3"
          >
            {props.canUploadAttachments || props.canBrowseLibrary ? (
              <InputGroupButton
                variant="ghost"
                size="icon-xs"
                type="button"
                disabled={draft.attachmentUploading || draft.attachmentSlotsLeft === 0}
                onClick={() => props.onOpenPicker(props.canUploadAttachments ? "files" : "library")}
                aria-label="Add files or Library items"
              >
                <Plus />
              </InputGroupButton>
            ) : null}
            <InputGroupButton
              variant="ghost"
              size="icon-xs"
              type="button"
              onClick={input.beginMention}
              aria-label="Mention someone"
            >
              <span aria-hidden="true">@</span>
            </InputGroupButton>
            <InputGroupText className="ml-auto tabular-nums">
              {draft.text.length}/{MAX_MESSAGE_LENGTH}
            </InputGroupText>
            <InputGroupButton
              className="ml-2 rounded-full bg-charcoal-active p-2 text-cream-bright transition-colors hover:bg-[#504942]"
              size="icon-sm"
              disabled={props.sending || draft.isEmpty}
              type="submit"
              aria-label="Send message"
            >
              <Send />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  );
}
