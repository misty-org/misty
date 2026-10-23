import { useMemo, type FormEvent } from "react";
import { SpaceChatPicker } from "@/features/chat-composer/SpaceChatPicker";
import type { SpaceChatDraft } from "@/features/chat-composer/useSpaceChatDraft";
import type { MistyPickerSource } from "@/features/picker";
import type { useSpaceAgentMembers } from "../../members/agents/useSpaceAgentMembers";
import type { ChatSuggestionsState } from "../hooks/useChatSuggestions";
import type { useComposerInput } from "../hooks/useComposerInput";
import type { useSpaceChatScope } from "../hooks/useSpaceChatData";
import type { useSpaceChatTyping } from "../hooks/useSpaceChatTyping";
import { ChatReadOnlyNotice } from "./ChatReadOnlyNotice";
import { SpaceChatComposer } from "./SpaceChatComposer";

type Scope = ReturnType<typeof useSpaceChatScope>;

/** The bottom of a Space chat: the composer (or a read-only notice) and its file picker. */
export function SpaceChatComposerArea({
  spaceId,
  canWrite,
  isConversation,
  draft,
  suggestions,
  input,
  typing,
  members,
  agents,
  messages,
  pickerOpen,
  pickerSource,
  onOpenPicker,
  onClosePicker,
  onSubmit,
}: {
  spaceId: string;
  canWrite: boolean;
  isConversation: boolean;
  draft: SpaceChatDraft;
  suggestions: ChatSuggestionsState;
  input: ReturnType<typeof useComposerInput>;
  typing: ReturnType<typeof useSpaceChatTyping>;
  members: Scope["members"];
  agents: ReturnType<typeof useSpaceAgentMembers>["agents"];
  messages: Scope["messages"];
  pickerOpen: boolean;
  pickerSource: MistyPickerSource;
  onOpenPicker: (source: MistyPickerSource) => void;
  onClosePicker: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const mentionNames = useMemo(
    () => [
      ...members.map((member) => member.name),
      ...(agents ?? []).map((agent) => agent.agent_name),
    ],
    [agents, members],
  );
  return (
    <>
      {canWrite ? (
        <SpaceChatComposer
          draft={draft}
          suggestions={suggestions}
          input={input}
          isConversation={isConversation}
          canUploadAttachments={canWrite}
          canBrowseLibrary={canWrite}
          mentionNames={mentionNames}
          typingLabel={typing.label}
          onTypingInput={typing.onTextInput}
          replyToSenderName={
            messages.find((item) => item.id === draft.replyToMessageId)?.sender_name ?? "message"
          }
          onSubmit={(event) => {
            typing.stop();
            onSubmit(event);
          }}
          onOpenPicker={onOpenPicker}
        />
      ) : (
        <ChatReadOnlyNotice />
      )}

      {pickerOpen ? (
        <SpaceChatPicker
          spaceId={spaceId}
          source={pickerSource}
          selectedLibraryIds={draft.selectedLibraryIds}
          pendingAttachmentCount={draft.pendingAttachments.length}
          canBrowseLibrary={canWrite}
          canUploadAttachments={canWrite}
          onClose={onClosePicker}
          onChooseFiles={(paths) => void draft.uploadAttachments(paths)}
          onChooseLibraryItems={draft.setSelectedLibraryIds}
        />
      ) : null}
    </>
  );
}
