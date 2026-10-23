import type { SpaceMessage } from "@/api/spaces/dto/entities";
import {
  useAiSurfaceAdapter,
  type AiArtifact,
  type AiSurfaceAdapter,
} from "@/features/ai-surface/AiPaneHost";
import type { SpaceChatDraft } from "@/features/chat-composer/useSpaceChatDraft";
import { useMemo } from "react";
import { spaceChatConversationPath, spaceChatPath } from "../chatRoute";
import { spaceChatSuggestedActions } from "../spaceChatAiActions";

/** Offers the open chat to the AI pane, which may draft a message into the empty composer. */
export function useSpaceChatAiAdapter(options: {
  spaceId: string;
  conversationId: string;
  available: boolean;
  canWrite: boolean;
  title?: string;
  messages: SpaceMessage[];
  draft: Pick<SpaceChatDraft, "text" | "setText" | "setReplyToMessageId">;
}) {
  const { spaceId, conversationId, available, canWrite, title, messages } = options;
  const draftText = options.draft.text;
  const setDraftText = options.draft.setText;
  const setDraftReplyToMessageId = options.draft.setReplyToMessageId;
  const aiAdapter = useMemo<AiSurfaceAdapter | null>(() => {
    if (!available) return null;
    const scopeId = conversationId || "everyone";
    const messageDraft = (artifact: AiArtifact) => {
      if (artifact.kind !== "message_draft" || !canWrite || draftText.trim()) {
        return null;
      }
      const operations = artifact.operations as {
        conversation_id?: string;
        text?: string;
        reply_to_message_id?: string;
      };
      if (
        operations.conversation_id !== scopeId ||
        typeof operations.text !== "string" ||
        !operations.text.trim() ||
        operations.text.length > 20_000
      ) {
        return null;
      }
      if (
        operations.reply_to_message_id &&
        !messages.some((message) => message.id === operations.reply_to_message_id)
      ) {
        return null;
      }
      return operations;
    };
    return {
      surfaceId: "space.chat",
      label: title || "Everyone chat",
      getContext: () => [
        {
          kind: "space.chat",
          id: scopeId,
          title: title || "Everyone chat",
          privacy: "shared",
          spaceId,
          href: conversationId
            ? spaceChatConversationPath(spaceId, conversationId)
            : spaceChatPath(spaceId),
          revision: messages[messages.length - 1]?.seq ?? 0,
        },
      ],
      getSuggestedActions: () => spaceChatSuggestedActions,
      canApply: (artifact) => Boolean(messageDraft(artifact)),
      applyArtifact: async (artifact) => {
        const operations = messageDraft(artifact);
        if (!operations) {
          throw new Error(
            "The conversation or composer changed. Ask your agent to regenerate this draft.",
          );
        }
        setDraftText(operations.text!.trim());
        setDraftReplyToMessageId(operations.reply_to_message_id ?? "");
      },
    };
  }, [
    canWrite,
    available,
    conversationId,
    draftText,
    title,
    messages,
    setDraftReplyToMessageId,
    setDraftText,
    spaceId,
  ]);
  useAiSurfaceAdapter(aiAdapter);
}
