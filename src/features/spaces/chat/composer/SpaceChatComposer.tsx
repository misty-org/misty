import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { File, Image, Paperclip, Plus, Reply, Smile, X } from "lucide-react";
import {
  ComposerAttachment,
  ComposerStatusRow,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  MessageComposer,
  MessageComposerSend,
  RoleDot,
  SuggestionItem,
  SuggestionList,
  Text,
  TypingLine,
  type ActionBarItem,
} from "@misty/ui";
import type { MistyPickerSource } from "@/features/files";
import { AgentMark } from "@/features/agents";
import type { ChatComposerSuggestion } from "../../api/dto/space-chat";
import type { SpaceMessage } from "../../api/dto/entities";
import type { SpaceChatDraft } from "./useSpaceChatDraft";
import { SpaceChatPicker } from "./SpaceChatPicker";
import type { ChatSuggestionsState } from "../hooks/useChatSuggestions";
import type { useComposerInput } from "../hooks/useComposerInput";
import type { useSpaceChatTyping } from "../hooks/useSpaceChatTyping";
import { ChatEmojiPicker } from "../emoji/ChatEmojiPicker";
import { ChatAvatar } from "../components/ChatAvatar";

const MAX_MESSAGE_LENGTH = 3000;

const groupTitles: Record<ChatComposerSuggestion["kind"], string> = {
  member: "Members",
  role: "Roles",
  agent: "Agents",
};

/**
 * Space chat's message box: @misty/ui's MessageComposer in its channel look. The + adds files or
 * media, a reply shows as a row at the top of the box, files waiting to go sit above the text,
 * and @ opens the suggestions over the box. Who is typing shows under it.
 */
export function SpaceChatComposer(props: {
  spaceId: string;
  canWrite: boolean;
  isConversation: boolean;
  draft: SpaceChatDraft;
  suggestions: ChatSuggestionsState;
  input: ReturnType<typeof useComposerInput>;
  typing: ReturnType<typeof useSpaceChatTyping>;
  messages: SpaceMessage[];
  pickerOpen: boolean;
  pickerSource: MistyPickerSource;
  onOpenPicker(source: MistyPickerSource): void;
  onClosePicker(): void;
  onSubmit(event: FormEvent): void;
  /** Up in an empty box edits the person's last message. */
  onEditLast?: () => void;
  placeholder: string;
}) {
  const { draft, suggestions } = props;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const focusEnd = () =>
    requestAnimationFrame(() => {
      const area = textarea.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    });
  const replyTo = props.messages.find((item) => item.id === draft.replyToMessageId);
  const listed = suggestions.open && suggestions.suggestions.length > 0;
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (listed) {
      const count = suggestions.suggestions.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        suggestions.setActiveIndex((current) => (current + step + count) % count);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        suggestions.setOpen(false);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
        event.preventDefault();
        const picked = suggestions.suggestions[suggestions.activeIndex];
        if (picked) {
          props.input.select(picked);
          focusEnd();
        }
        return;
      }
    }
    if (event.key === "Escape" && !event.shiftKey && draft.replyToMessageId) {
      event.preventDefault();
      draft.setReplyToMessageId("");
      return;
    }
    if (
      event.key === "ArrowUp" &&
      !draft.text &&
      !event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      if (props.onEditLast) {
        event.preventDefault();
        props.onEditLast();
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!draft.isEmpty && !draft.attachmentUploading) form.current?.requestSubmit();
    }
  };
  const remaining = MAX_MESSAGE_LENGTH - draft.text.length;
  const noSlots = draft.attachmentSlotsLeft === 0;
  // The same rows in the + menu and, once the bar has folded it, in its ⋯.
  const addRows = (
    <>
      <MenuItem
        icon={Paperclip}
        label="Upload file"
        disabled={noSlots}
        onSelect={() => props.onOpenPicker("files")}
      />
      <MenuItem
        icon={Image}
        label="Add from Files"
        disabled={noSlots}
        onSelect={() => props.onOpenPicker("space")}
      />
    </>
  );
  const add: ActionBarItem = {
    id: "add",
    icon: Plus,
    label: "Add to message",
    priority: 3,
    disabled: draft.attachmentUploading,
    render: () => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="Add to message" disabled={draft.attachmentUploading}>
            <Plus />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top">
          {addRows}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    menu: addRows,
  };
  const hasAttachments = draft.pendingAttachments.length > 0;
  let lastKind = "";
  const popup = listed ? (
    <SuggestionList
      aria-label="Suggestions"
      className="absolute -right-3 bottom-full -left-3 z-[var(--stack-overlay)] mb-4 max-h-70 overflow-y-auto"
    >
      {suggestions.suggestions.map((suggestion, index) => {
        const heading = suggestion.kind !== lastKind ? groupTitles[suggestion.kind] : "";
        lastKind = suggestion.kind;
        return (
          <div key={`${suggestion.kind}:${suggestion.id}`} role="presentation">
            {heading ? (
              <Text as="div" size="caption" weight="medium" tone="muted" className="px-2 pt-2 pb-1">
                {heading}
              </Text>
            ) : null}
            <SuggestionItem
              selected={index === suggestions.activeIndex}
              onPointerEnter={() => suggestions.setActiveIndex(index)}
              onPointerDown={() => {
                props.input.select(suggestion);
                focusEnd();
              }}
              icon={
                suggestion.kind === "member" ? (
                  <ChatAvatar id={suggestion.id} name={suggestion.label} size="xs" />
                ) : suggestion.kind === "agent" ? (
                  <AgentMark agentId={suggestion.id} />
                ) : (
                  <RoleDot color={suggestion.color} />
                )
              }
              label={suggestion.kind === "role" ? `@${suggestion.label}` : suggestion.label}
              detail={suggestion.detail}
            />
          </div>
        );
      })}
    </SuggestionList>
  ) : null;
  return (
    <section aria-label="Message composer" className="shrink-0 px-4 pb-4">
      <TypingLine label={props.typing.label || undefined} />
      <form
        ref={form}
        onSubmit={(event) => {
          props.typing.stop();
          props.onSubmit(event);
        }}
      >
        <MessageComposer
          variant="channel"
          data-tour="space-chat-composer"
          inputRef={textarea}
          inputProps={{
            role: "combobox",
            "aria-label": props.isConversation ? "Message this channel" : "Message this Space",
            "aria-autocomplete": "list",
            "aria-expanded": listed,
            maxLength: MAX_MESSAGE_LENGTH,
            disabled: !props.canWrite,
            value: draft.text,
            placeholder: props.canWrite
              ? props.placeholder
              : "You can't send messages in this channel.",
            onChange: (event) => {
              props.input.onChange(event.target.value);
              props.typing.onTextInput(event.target.value);
            },
            onKeyDown,
          }}
          status={
            replyTo ? (
              <ComposerStatusRow
                icon={Reply}
                label="Replying to"
                actions={
                  <IconButton label="Cancel reply" onClick={() => draft.setReplyToMessageId("")}>
                    <X />
                  </IconButton>
                }
              >
                {replyTo.sender_name}
              </ComposerStatusRow>
            ) : undefined
          }
          context={
            hasAttachments ? (
              <>
                {draft.pendingAttachments.map((attachment) => (
                  <ComposerAttachment
                    key={attachment.id}
                    icon={File}
                    name={attachment.display_name}
                    onRemove={() =>
                      draft.setPendingAttachments((current) =>
                        current.filter((item) => item.id !== attachment.id),
                      )
                    }
                  />
                ))}
              </>
            ) : undefined
          }
          overlay={popup}
          items={props.canWrite ? [add] : []}
          end={
            props.canWrite ? (
              <>
                {remaining < MAX_MESSAGE_LENGTH * 0.2 ? (
                  <Text
                    bare
                    size="caption"
                    tone={remaining < 50 ? "danger" : "muted"}
                    className="px-1 tabular-nums"
                    aria-label={
                      remaining < 0 ? "Message is too long" : `${remaining} characters left`
                    }
                  >
                    {remaining}
                  </Text>
                ) : null}
                <ChatEmojiPicker
                  side="top"
                  align="end"
                  open={emojiOpen}
                  onOpenChange={setEmojiOpen}
                  onSelect={(emoji) => {
                    draft.setText((current) => current + emoji);
                    focusEnd();
                  }}
                >
                  <IconButton label="Emoji" aria-pressed={emojiOpen}>
                    <Smile />
                  </IconButton>
                </ChatEmojiPicker>
                <MessageComposerSend
                  type="submit"
                  label="Send message"
                  disabled={draft.isEmpty || remaining < 0}
                  busy={draft.attachmentUploading}
                />
              </>
            ) : undefined
          }
        />
      </form>
      {props.pickerOpen ? (
        <SpaceChatPicker
          spaceId={props.spaceId}
          source={props.pickerSource}
          pendingAttachmentCount={draft.pendingAttachments.length}
          canBrowseDrive={props.canWrite}
          canUploadAttachments={props.canWrite}
          onClose={props.onClosePicker}
          onChooseFiles={(paths) => void draft.uploadAttachments(paths)}
          onChooseDriveFiles={(files) => void draft.attachDriveFiles(files)}
        />
      ) : null}
    </section>
  );
}
