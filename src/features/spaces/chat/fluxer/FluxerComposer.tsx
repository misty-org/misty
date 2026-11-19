// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from Fluxer (https://github.com/fluxerapp/fluxer): features/channel/components/
// ChannelTextarea.tsx, LexicalChannelTextareaContent.tsx, textarea/TextareaButton(s).tsx,
// TextareaPlusMenu.tsx, ChannelReplyBar.tsx, ChannelAttachmentArea.tsx, MessageCharacterCounter.tsx,
// TypingUsers.tsx, Autocomplete.tsx and AutocompleteItem.tsx, with their CSS, on a plain textarea
// over Misty's draft, @ suggestions and file pickers.
import {
  Fragment,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type ComponentPropsWithoutRef,
} from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  File,
  Image,
  Paperclip,
  Plus,
  Smile,
  Trash2,
  CircleX,
  type LucideIcon,
} from "lucide-react";
import type { MistyPickerSource } from "@/features/files";
import { AgentMark } from "@/features/agents";
import type { ChatComposerSuggestion } from "../../api/dto/space-chat";
import type { SpaceChatDraft } from "../composer/useSpaceChatDraft";
import { SpaceChatPicker } from "../composer/SpaceChatPicker";
import { splitMentionSegments } from "../hooks/mentionHighlight";
import type { ChatSuggestionsState } from "../hooks/useChatSuggestions";
import type { useComposerInput } from "../hooks/useComposerInput";
import type { useSpaceChatTyping } from "../hooks/useSpaceChatTyping";
import type { MentionableAgent } from "../useSpaceMessageSpansStore";
import type { SpaceMessage } from "../../api/dto/entities";
import type { useSpaceChatScope } from "../hooks/useSpaceChatData";
import { FluxerTooltip } from "./FluxerTooltip";
import { FluxerEmojiPicker } from "./FluxerEmojiPicker";
import { FluxerMenu } from "./FluxerMenu";
import { FluxerAvatar } from "./FluxerAvatar";
import { cx } from "./cx";
import layout from "./css/ChannelChatLayout.module.css";
import wrapper from "./css/InputWrapper.module.css";
import input from "./css/TextareaInput.module.css";
import button from "./css/TextareaButton.module.css";
import composer from "./css/LexicalMessageComposer.module.css";
import host from "./css/LexicalChannelTextareaContent.module.css";
import reply from "./css/ChannelReplyBar.module.css";
import attachments from "./css/ChannelAttachmentArea.module.css";
import counterBox from "./css/MessageCharacterCounter.module.css";
import counter from "./css/CharacterCounter.module.css";
import message from "./css/Message.module.css";
import typingUsers from "./css/TypingUsers.module.css";
import dots from "./css/Typing.module.css";
import autocomplete from "./css/Autocomplete.module.css";
import option from "./css/AutocompleteItem.module.css";
import markup from "./css/Markup.module.css";

const MAX_MESSAGE_LENGTH = 3000;

type Scope = ReturnType<typeof useSpaceChatScope>;

export function FluxerComposer(props: {
  spaceId: string;
  canWrite: boolean;
  isConversation: boolean;
  draft: SpaceChatDraft;
  suggestions: ChatSuggestionsState;
  input: ReturnType<typeof useComposerInput>;
  typing: ReturnType<typeof useSpaceChatTyping>;
  members: Scope["members"];
  agents: readonly MentionableAgent[];
  messages: SpaceMessage[];
  memberColors?: Map<string, string>;
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
  const box = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const plus = useRef<HTMLButtonElement>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const mentionNames = useMemo(
    () => [
      ...props.members.map((member) => member.name),
      ...props.agents.map((agent) => agent.agent_name),
    ],
    [props.agents, props.members],
  );
  const segments = useMemo(
    () => splitMentionSegments(draft.text, mentionNames),
    [draft.text, mentionNames],
  );
  const hasMention = segments.some((segment) => segment.mention);
  useLayoutEffect(() => {
    const area = textarea.current;
    if (!area) return;
    area.style.height = "0px";
    area.style.height = `${Math.min(area.scrollHeight, window.innerHeight / 2)}px`;
  }, [draft.text]);
  const focusEnd = () =>
    requestAnimationFrame(() => {
      const area = textarea.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    });
  const replyTo = props.messages.find((item) => item.id === draft.replyToMessageId);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (suggestions.open && suggestions.suggestions.length) {
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
      if ((event.key === "Enter" && !event.shiftKey) || (event.key === "Tab" && !event.shiftKey)) {
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
      if (!draft.isEmpty && !draft.attachmentUploading) event.currentTarget.form?.requestSubmit();
    }
  };
  const remaining = MAX_MESSAGE_LENGTH - draft.text.length;
  const typing = props.typing.names;
  const hasAttachments = draft.pendingAttachments.length > 0 || draft.selectedLibraryIds.length > 0;
  return (
    <section className={layout.textareaArea} aria-label="Message composer">
      <form
        onSubmit={(event) => {
          props.typing.stop();
          props.onSubmit(event);
        }}
      >
        <Popover.Root
          open={suggestions.open && (suggestions.suggestions.length > 0 || suggestions.loading)}
          onOpenChange={suggestions.setOpen}
        >
          <Popover.Anchor asChild>
            <div
              ref={box}
              data-tour="space-chat-composer"
              className={cx(
                wrapper.box,
                wrapper.composerRoot,
                wrapper.wrapperSides,
                input.textareaOuter,
                wrapper.roundedAll,
                input.textareaOuterRow,
                !props.canWrite && wrapper.disabled,
              )}
            >
              <div className={wrapper.statusRail}>
                <div className={wrapper.statusRailLeft}>
                  {typing.length && !suggestions.open ? (
                    <div className={wrapper.statusTypingSlot}>
                      <TypingUsers names={typing} colors={props.memberColors} />
                    </div>
                  ) : null}
                  <span className="sr-only" aria-live="polite">
                    {props.typing.label}
                  </span>
                </div>
              </div>
              {replyTo ? (
                <div className={wrapper.composerActionStack}>
                  <div className={wrapper.composerActionRow}>
                    <div
                      className={cx(
                        wrapper.box,
                        wrapper.wrapperSides,
                        wrapper.roundedTop,
                        wrapper.noBottomBorder,
                      )}
                    >
                      <div className={wrapper.barInner}>
                        <button
                          type="button"
                          className={cx(reply.text, reply.replyTargetButton)}
                          onClick={() =>
                            document
                              .getElementById(`message-${replyTo.id}`)
                              ?.scrollIntoView({ block: "center" })
                          }
                        >
                          {"Replying to "}
                          <span className={reply.authorName}>{replyTo.sender_name}</span>
                        </button>
                        <div className={reply.controls}>
                          <FluxerTooltip content="Cancel reply">
                            <button
                              type="button"
                              aria-label="Cancel reply"
                              className={reply.closeButton}
                              onClick={() => draft.setReplyToMessageId("")}
                            >
                              <CircleX className={reply.closeIcon} />
                            </button>
                          </FluxerTooltip>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
              {hasAttachments ? (
                <div className={cx(wrapper.stackSection, input.collapsibleSection)}>
                  <div className={attachments.scroller} style={{ overflowX: "auto" }}>
                    <ul
                      className={attachments.channelAttachmentArea}
                      style={{ listStyle: "none", margin: 0 }}
                    >
                      {draft.pendingAttachments.map((attachment) => (
                        <AttachmentCard
                          key={attachment.id}
                          name={attachment.display_name}
                          onRemove={() =>
                            draft.setPendingAttachments((current) =>
                              current.filter((item) => item.id !== attachment.id),
                            )
                          }
                        />
                      ))}
                      {draft.selectedLibraryIds.map((id) => (
                        <AttachmentCard
                          key={id}
                          name={
                            suggestions.libraryItems.find((item) => item.id === id)?.display_name ??
                            "File"
                          }
                          media
                          onRemove={() =>
                            draft.setSelectedLibraryIds((current) =>
                              current.filter((item) => item !== id),
                            )
                          }
                        />
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
              <div className={cx(wrapper.stackSection, input.inputSection)}>
                <div className={input.mainWrapperDense}>
                  <div className={cx(input.uploadButtonColumn, input.sideButtonPadding)}>
                    {props.canWrite ? (
                      <TextareaButton
                        label="Open menu"
                        icon={Plus}

                        ref={plus}
                        selected={plusOpen}
                        disabled={draft.attachmentUploading}
                        onClick={() => setPlusOpen((current) => !current)}
                      />
                    ) : null}
                  </div>
                  <div className={input.contentAreaDense}>
                    <div className={host.composerHost}>
                      {hasMention ? (
                        <div
                          ref={overlay}
                          aria-hidden="true"
                          className={cx(composer.editable, host.composerEditable)}
                          style={{
                            position: "absolute",
                            inset: 0,
                            pointerEvents: "none",
                            overflow: "hidden",
                          }}
                        >
                          {segments.map((segment, index) =>
                            segment.mention ? (
                              <span
                                key={index}
                                className={cx("markup", markup.markup)}
                                style={{ display: "inline" }}
                              >
                                <span className={markup.mention} style={{ paddingInline: 0 }}>
                                  {segment.text}
                                </span>
                              </span>
                            ) : (
                              <Fragment key={index}>{segment.text}</Fragment>
                            ),
                          )}
                          {draft.text.endsWith("\n") ? "​" : null}
                        </div>
                      ) : null}
                      <textarea
                        ref={textarea}
                        rows={1}
                        role="combobox"
                        aria-label={
                          props.isConversation ? "Message this channel" : "Message this Space"
                        }
                        aria-autocomplete="list"
                        aria-expanded={suggestions.open}
                        maxLength={MAX_MESSAGE_LENGTH}
                        disabled={!props.canWrite}
                        value={draft.text}
                        className={cx(composer.editable, host.composerEditable)}
                        style={{
                          display: "block",
                          resize: "none",
                          border: "none",
                          background: "transparent",
                          position: "relative",
                          color: hasMention ? "transparent" : undefined,
                        }}
                        onChange={(event) => {
                          props.input.onChange(event.target.value);
                          props.typing.onTextInput(event.target.value);
                        }}
                        onKeyDown={onKeyDown}
                        onScroll={(event) => {
                          if (overlay.current)
                            overlay.current.scrollTop = event.currentTarget.scrollTop;
                        }}
                      />
                      {draft.text ? null : (
                        <div className={composer.placeholder}>
                          {props.canWrite
                            ? props.placeholder
                            : "You can't send messages in this channel."}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={cx(input.buttonContainerDense, input.sideButtonPadding)}>
                    {props.canWrite ? (
                      <>
                        <TextareaButton
                          label="Media"
                          icon={Image}
                          disabled={draft.attachmentUploading || draft.attachmentSlotsLeft === 0}
                          onClick={() => props.onOpenPicker("library")}
                        />
                        <FluxerEmojiPicker
                          side="top"
                          align="end"
                          onOpenChange={setEmojiOpen}
                          onSelect={(emoji) => {
                            draft.setText((current) => current + emoji);
                            focusEnd();
                          }}
                        >
                          <TextareaButton label="Emojis" icon={Smile} selected={emojiOpen} />
                        </FluxerEmojiPicker>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
              {remaining < MAX_MESSAGE_LENGTH * 0.2 ? (
                <div className={counterBox.container}>
                  <FluxerTooltip
                    content={remaining < 0 ? "Message is too long" : `${remaining} characters left`}
                  >
                    <span
                      className={cx(
                        counter.counter,
                        remaining < 50 ? counter.textDanger : counter.textTertiary,
                      )}
                    >
                      {remaining}
                    </span>
                  </FluxerTooltip>
                </div>
              ) : null}
            </div>
          </Popover.Anchor>
          <Popover.Portal>
            <Popover.Content
              side="top"
              align="start"
              sideOffset={4}
              collisionPadding={16}
              onOpenAutoFocus={(event) => event.preventDefault()}
              onInteractOutside={(event) => {
                if (box.current?.contains(event.target as Node)) event.preventDefault();
              }}
              className={cx("fluxer-chat", autocomplete.container, autocomplete.containerAttached)}
              style={{ width: "var(--radix-popper-anchor-width)", zIndex: 60 }}
            >
              <SuggestionList
                suggestions={suggestions.suggestions}
                activeIndex={suggestions.activeIndex}
                onHover={suggestions.setActiveIndex}
                onPick={(picked) => {
                  props.input.select(picked);
                  focusEnd();
                }}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </form>
      <FluxerMenu
        label="Add to message"
        open={plusOpen}
        onOpenChange={setPlusOpen}
        anchor={plus}
        side="top"
        align="start"
        groups={[
          [
            {
              label: "Upload file",
              icon: Paperclip,
              disabled: draft.attachmentSlotsLeft === 0,
              onSelect: () => props.onOpenPicker("files"),
            },
            {
              label: "Add from Media",
              icon: Image,
              disabled: draft.attachmentSlotsLeft === 0,
              onSelect: () => props.onOpenPicker("library"),
            },
          ],
        ]}
      />
      {props.pickerOpen ? (
        <SpaceChatPicker
          spaceId={props.spaceId}
          source={props.pickerSource}
          selectedLibraryIds={draft.selectedLibraryIds}
          pendingAttachmentCount={draft.pendingAttachments.length}
          canBrowseLibrary={props.canWrite}
          canUploadAttachments={props.canWrite}
          onClose={props.onClosePicker}
          onChooseFiles={(paths) => void draft.uploadAttachments(paths)}
          onChooseLibraryItems={draft.setSelectedLibraryIds}
        />
      ) : null}
    </section>
  );
}

/** TextareaButton: 32px, a 22px glyph, muted until hovered or open. */
// Forwards its ref and any other props to the button, so it can be a popover's trigger.
const TextareaButton = forwardRef<
  HTMLButtonElement,
  Omit<ComponentPropsWithoutRef<"button">, "children"> & {
    label: string;
    icon: LucideIcon;
    selected?: boolean;
  }
>(function TextareaButton({ label, icon: Glyph, selected, className, ...rest }, ref) {
  return (
    <FluxerTooltip content={label}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        {...rest}
        className={cx(button.button, selected && button.selected, className)}
      >
        <Glyph className={button.icon} />
      </button>
    </FluxerTooltip>
  );
});

/** TypingUsers in the status rail: blinking dots, then "Name is typing...", names in bold. */
function TypingUsers(props: {
  names: { userId: string; name: string }[];
  colors?: Map<string, string>;
}) {
  const named = (person: { userId: string; name: string }) => (
    <strong
      key={person.userId}
      className={typingUsers.username}
      style={
        props.colors?.get(person.userId) ? { color: props.colors.get(person.userId) } : undefined
      }
    >
      {person.name}
    </strong>
  );
  const [a, b, c] = props.names;
  let text: ReactNode;
  if (props.names.length > 3) text = "Several people are typing...";
  else if (c && b && a)
    text = (
      <>
        {named(a)}, {named(b)} and {named(c)} are typing...
      </>
    );
  else if (b && a)
    text = (
      <>
        {named(a)} and {named(b)} are typing...
      </>
    );
  else if (a) text = <>{named(a)} is typing...</>;
  return (
    <div
      className={cx(
        message.typingContainer,
        message.typingCluster,
        message.typingClusterComposerStatus,
      )}
    >
      <div className={typingUsers.composerStatus}>
        <div className={message.typingIndicator}>
          <svg
            className={typingUsers.typing}
            viewBox="0 0 20 5"
            width="16"
            height="16"
            aria-hidden="true"
            style={{ fill: "var(--typing-indicator-color, var(--text-chat))" }}
          >
            <circle className={dots.dot} cx="2.5" cy="2.5" r="2.5" />
            <circle className={dots.dot} cx="8.75" cy="2.5" r="2.5" />
            <circle className={dots.dot} cx="15" cy="2.5" r="2.5" />
          </svg>
        </div>
        <span className={message.typingText}>{text}</span>
      </div>
    </div>
  );
}

/** A file waiting to be sent: Fluxer's 200px upload card, with remove at its corner. */
function AttachmentCard(props: { name: string; media?: boolean; onRemove(): void }) {
  const extension = props.name.includes(".") ? props.name.split(".").pop() : "";
  return (
    <li className={attachments.upload}>
      <div className={attachments.uploadContainer}>
        <div className={attachments.icon}>
          {props.media ? (
            <Image className={attachments.iconImage} />
          ) : (
            <File className={attachments.iconImage} />
          )}
        </div>
        <div className={attachments.filenameContainer}>
          <div className={attachments.filename}>{props.name}</div>
          <div className={attachments.fileDetails}>
            <span className={attachments.fileSize}>{props.media ? "Media" : "File"}</span>
            {extension ? <span className={attachments.fileExtension}>{extension}</span> : null}
          </div>
        </div>
      </div>
      <div className={attachments.actionBarContainer}>
        <div className={attachments.actionBar}>
          <FluxerTooltip content="Remove attachment">
            <button
              type="button"
              aria-label="Remove attachment"
              className={cx(attachments.button, attachments.danger)}
              onClick={props.onRemove}
            >
              <Trash2 className={attachments.actionBarIcon} />
            </button>
          </FluxerTooltip>
        </div>
      </div>
    </li>
  );
}

const groupTitles: Record<ChatComposerSuggestion["kind"], string> = {
  member: "Members",
  role: "Roles",
  agent: "Agents",
  library: "Media",
};

/** The @ autocomplete: Fluxer's rows grouped under their headings, 4px above the box. */
function SuggestionList(props: {
  suggestions: ChatComposerSuggestion[];
  activeIndex: number;
  onHover(index: number): void;
  onPick(suggestion: ChatComposerSuggestion): void;
}) {
  let lastKind = "";
  return (
    <div
      role="listbox"
      aria-label="Suggestions"
      className={autocomplete.scroller}
      style={{ overflowY: "auto" }}
    >
      {props.suggestions.map((suggestion, index) => {
        const heading = suggestion.kind !== lastKind ? groupTitles[suggestion.kind] : "";
        const first = lastKind === "";
        lastKind = suggestion.kind;
        return (
          <Fragment key={`${suggestion.kind}:${suggestion.id}`}>
            {heading ? (
              <>
                {first ? null : (
                  <div
                    style={{
                      margin: "4px 0",
                      height: 1,
                      backgroundColor: "var(--background-modifier-hover)",
                    }}
                  />
                )}
                <div className={autocomplete.sectionHeading}>{heading}</div>
              </>
            ) : null}
            <button
              type="button"
              role="option"
              aria-selected={index === props.activeIndex}
              className={option.button}
              style={{ width: "100%" }}
              onMouseEnter={() => props.onHover(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => props.onPick(suggestion)}
            >
              <div className={cx(option.container, index === props.activeIndex && option.selected)}>
                <div className={option.content}>
                  <div className={option.icon}>
                    {suggestion.kind === "member" ? (
                      <FluxerAvatar id={suggestion.id} name={suggestion.label} size={24} />
                    ) : suggestion.kind === "agent" ? (
                      <AgentMark agentId={suggestion.id} />
                    ) : suggestion.kind === "library" ? (
                      <Image size={16} />
                    ) : null}
                  </div>
                  <div className={option.nameWrapper}>
                    <div
                      className={option.name}
                      style={
                        suggestion.kind === "role" && suggestion.color
                          ? { color: suggestion.color }
                          : undefined
                      }
                    >
                      {suggestion.kind === "role" ? `@${suggestion.label}` : suggestion.label}
                    </div>
                  </div>
                  {suggestion.detail ? (
                    <div className={option.description}>
                      <span>{suggestion.detail}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
