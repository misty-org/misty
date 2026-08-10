import type { SpaceChatDraft } from "@/features/chat-composer/useSpaceChatDraft";
import type { MistyPickerSource } from "@/features/picker";
import {
  cn,
  IconButton,
  MessageComposer,
  MessageComposerSend,
  messageComposerTextClass,
  InputGroupText,
  Popover,
  PopoverAnchor,
  PopoverTrigger,
} from "@/shared/ui";
import { AtSign, Plus, Smile } from "lucide-react";
import { useId, useMemo, useRef, type FormEvent, type KeyboardEvent } from "react";
import { splitMentionSegments } from "../hooks/mentionHighlight";
import type { ChatSuggestionsState } from "../hooks/useChatSuggestions";
import type { useComposerInput } from "../hooks/useComposerInput";
import { ChatEmojiPicker } from "./ChatEmojiPicker";
import { ChatAttachmentChips } from "./ChatAttachmentChips";
import { ChatReplyBanner } from "./ChatReplyBanner";
import { ChatSuggestionPopover } from "./ChatSuggestionPopover";
const MAX_MESSAGE_LENGTH = 3000;
// Most messages are nowhere near the cap, so the counter only earns its
// place in the toolbar once it's actually useful information.
const MESSAGE_LENGTH_WARNING_THRESHOLD = MAX_MESSAGE_LENGTH - 200;

export interface SpaceChatComposerProps {
  draft: SpaceChatDraft;
  suggestions: ChatSuggestionsState;
  input: ReturnType<typeof useComposerInput>;
  isConversation: boolean;
  canUploadAttachments: boolean;
  canBrowseLibrary: boolean;
  replyToSenderName: string;
  /** Real names in the Space's roster, so only actual mentions light up. */
  mentionNames: string[];
  onSubmit: (event: FormEvent) => void;
  onOpenPicker: (source: MistyPickerSource) => void;
}
export function SpaceChatComposer(props: SpaceChatComposerProps) {
  const { draft, suggestions, input } = props;
  const listId = useId();
  const composerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const mentionSegments = useMemo(
    () => splitMentionSegments(draft.text, props.mentionNames),
    [draft.text, props.mentionNames],
  );
  const hasMention = mentionSegments.some((segment) => segment.mention);

  // `input.select`/`input.beginMention` always insert at the end of the
  // text, but React re-renders `value` without moving the browser's own
  // caret, so it's left wherever it was before the click/keypress. Push it
  // to the end after the DOM has actually updated.
  const focusCaretToEnd = () => {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
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
        if (selected) {
          input.select(selected);
          focusCaretToEnd();
        }
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!draft.isEmpty && !draft.attachmentUploading) event.currentTarget.form?.requestSubmit();
    }
  };
  return (
    <div className={cn("shrink-0 bg-charcoal-bg px-[clamp(16px,2.5vw,32px)] pt-2", "pb-5")}>
      <form onSubmit={props.onSubmit}>
        <Popover open={suggestions.open} onOpenChange={suggestions.setOpen}>
          <PopoverAnchor asChild>
            <MessageComposer
              ref={composerRef}
              inputRef={textareaRef}
              context={
                <>
                  {draft.replyToMessageId ? (
                    <ChatReplyBanner
                      senderName={props.replyToSenderName}
                      onCancel={() => draft.setReplyToMessageId("")}
                    />
                  ) : null}

                  <ChatAttachmentChips
                    pendingAttachments={draft.pendingAttachments}
                    selectedLibraryIds={draft.selectedLibraryIds}
                    libraryItems={suggestions.libraryItems}
                    onRemoveAttachment={(id) =>
                      draft.setPendingAttachments((current) =>
                        current.filter((item) => item.id !== id),
                      )
                    }
                    onRemoveLibraryItem={(id) =>
                      draft.setSelectedLibraryIds((current) =>
                        current.filter((item) => item !== id),
                      )
                    }
                  />
                </>
              }
              overlay={
                hasMention ? (
                  <div
                    ref={overlayRef}
                    aria-hidden="true"
                    className={cn(
                      messageComposerTextClass,
                      "pointer-events-none absolute inset-0 overflow-hidden text-cream",
                    )}
                  >
                    {mentionSegments.map((segment, index) =>
                      segment.mention ? (
                        <mark
                          key={index}
                          className="-mx-1 rounded-[3px] bg-charcoal-active px-1 py-0.5 text-cream"
                        >
                          {segment.text}
                        </mark>
                      ) : (
                        segment.text
                      ),
                    )}
                    {draft.text.endsWith("\n") ? "​" : null}
                  </div>
                ) : null
              }
              inputProps={{
                className: cn(
                  "relative",
                  hasMention && "text-transparent caret-cream placeholder:text-transparent",
                ),
                "aria-label": props.isConversation ? "Message this group" : "Message this Space",
                "aria-autocomplete": "list",
                "aria-controls": suggestions.open ? listId : undefined,
                "aria-expanded": suggestions.open,
                "aria-haspopup": "listbox",
                "aria-activedescendant":
                  suggestions.open && suggestions.suggestions[suggestions.activeIndex]
                    ? `${listId}-option-${suggestions.activeIndex}`
                    : undefined,
                role: "combobox",
                wrap: "soft",
                maxLength: MAX_MESSAGE_LENGTH,
                placeholder: "Write a message…",
                value: draft.text,
                onChange: (event) => input.onChange(event.target.value),
                onKeyDown,
                onScroll: (event) => {
                  if (overlayRef.current)
                    overlayRef.current.scrollTop = event.currentTarget.scrollTop;
                },
              }}
              footer={
                draft.text.length >= MESSAGE_LENGTH_WARNING_THRESHOLD ? (
                  <InputGroupText className="ml-auto tabular-nums">
                    {draft.text.length}/{MAX_MESSAGE_LENGTH}
                  </InputGroupText>
                ) : undefined
              }
              leading={
                props.canUploadAttachments || props.canBrowseLibrary ? (
                  <IconButton
                    variant="toolbar"
                    size="sm"
                    type="button"
                    disabled={draft.attachmentUploading || draft.attachmentSlotsLeft === 0}
                    onClick={() =>
                      props.onOpenPicker(props.canUploadAttachments ? "files" : "library")
                    }
                    label="Add files or Library items"
                  >
                    <Plus />
                  </IconButton>
                ) : null
              }
              actions={
                <>
                  <PopoverTrigger asChild>
                    <IconButton
                      variant="toolbar"
                      size="sm"
                      type="button"
                      onClick={() => {
                        input.beginMention();
                        focusCaretToEnd();
                      }}
                      label="Mention someone"
                    >
                      <AtSign />
                    </IconButton>
                  </PopoverTrigger>
                  <ChatEmojiPicker
                    onSelect={(emoji) => {
                      draft.setText((current) => current + emoji);
                      focusCaretToEnd();
                    }}
                  >
                    <IconButton variant="toolbar" size="sm" type="button" label="Insert emoji">
                      <Smile />
                    </IconButton>
                  </ChatEmojiPicker>

                  <MessageComposerSend
                    type="submit"
                    label="Send message"
                    disabled={draft.isEmpty || draft.attachmentUploading}
                  />
                </>
              }
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
            onSelect={(suggestion) => {
              input.select(suggestion);
              focusCaretToEnd();
            }}
            onBrowseLibrary={() => {
              suggestions.setOpen(false);
              props.onOpenPicker("library");
            }}
            onUploadFiles={() => {
              suggestions.setOpen(false);
              props.onOpenPicker("files");
            }}
            onInteractOutside={(event) => {
              const target = event.target;
              if (target instanceof Node && composerRef.current?.contains(target)) {
                event.preventDefault();
              }
            }}
          />
        </Popover>
      </form>
    </div>
  );
}
