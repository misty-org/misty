import { buildMessageSpans, mergeSpaceMessages } from "@/features/space-chat";
import { resolveSpacesApiBase, spacesApi } from "@/services/spaces/api";
import { errorText } from "@/shared/lib/format";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import type { SpacesStore } from "../model/stores/spaces/interfaces/useSpacesStore";
export { buildMessageSpans } from "@/features/space-chat";

type SpacesSet = (
  partial: Partial<SpacesStore> | ((state: SpacesStore) => Partial<SpacesStore>),
) => void;
export function createSpaceContentActions(
  set: SpacesSet,
  get: () => SpacesStore,
): Pick<
  SpacesStore,
  | "sendMessage"
  | "updateMessage"
  | "deleteMessage"
  | "toggleMessageReaction"
  | "markRead"
  | "openNode"
  | "saveStudio"
  | "deleteStudio"
  | "runStudio"
  | "markInboxSeen"
  | "clearInbox"
> {
  return {
    sendMessage: async (
      spaceId,
      text,
      fileNodeIds = [],
      attachmentIds = [],
      libraryItemIds = [],
      replyToMessageId = "",
      selectedAgentIdsByLabel = {},
    ) => {
      const trimmed = text.trim();
      if (
        !trimmed &&
        attachmentIds.length === 0 &&
        libraryItemIds.length === 0 &&
        fileNodeIds.length === 0
      )
        return;
      set({ sending: true, error: null });
      try {
        const spans = trimmed
          ? buildMessageSpans(
              trimmed,
              get().membersBySpace[spaceId] ?? [],
              get().agentsBySpace[spaceId] ?? [],
              selectedAgentIdsByLabel,
            )
          : [];
        const response = await spacesApi.sendMessage(
          spaceId,
          spans,
          fileNodeIds,
          attachmentIds,
          libraryItemIds,
          replyToMessageId,
        );
        response.message.triggered_runs = response.triggered_runs;
        set((state) => ({
          sending: false,
          error: null,
          messagesBySpace: {
            ...state.messagesBySpace,
            [spaceId]: mergeSpaceMessages(state.messagesBySpace[spaceId] ?? [], [response.message]),
          },
        }));
      } catch (error) {
        set({ sending: false, error: errorText(error) });
        throw error;
      }
    },

    updateMessage: async (spaceId, messageId, text, fileNodeIds = []) => {
      set({ error: null });
      try {
        const spans = buildMessageSpans(
          text.trim(),
          get().membersBySpace[spaceId] ?? [],
          get().agentsBySpace[spaceId] ?? [],
        );
        const saved = await spacesApi.updateMessage(spaceId, messageId, spans, fileNodeIds);
        set((state) => ({
          messagesBySpace: {
            ...state.messagesBySpace,
            [spaceId]: mergeSpaceMessages(state.messagesBySpace[spaceId] ?? [], [saved]),
          },
        }));
      } catch (error) {
        set({ error: errorText(error) });
        throw error;
      }
    },

    deleteMessage: async (spaceId, messageId) => {
      set({ error: null });
      try {
        await spacesApi.deleteMessage(spaceId, messageId);
        set((state) => ({
          messagesBySpace: {
            ...state.messagesBySpace,
            [spaceId]: (state.messagesBySpace[spaceId] ?? []).filter(
              (item) => item.id !== messageId,
            ),
          },
        }));
      } catch (error) {
        set({ error: errorText(error) });
        throw error;
      }
    },

    toggleMessageReaction: async (spaceId, messageId, emoji, reacted) => {
      set({ error: null });
      try {
        const saved = reacted
          ? await spacesApi.removeMessageReaction(spaceId, messageId, emoji)
          : await spacesApi.addMessageReaction(spaceId, messageId, emoji);
        set((state) => ({
          messagesBySpace: {
            ...state.messagesBySpace,
            [spaceId]: mergeSpaceMessages(state.messagesBySpace[spaceId] ?? [], [saved]),
          },
        }));
      } catch (error) {
        set({ error: errorText(error) });
        throw error;
      }
    },

    markRead: async (spaceId, seq) => {
      await spacesApi.markRead(spaceId, seq);
      await get().loadInbox();
    },

    openNode: async (spaceId, nodeId, disposition = "open") => {
      const [ticket, base] = await Promise.all([
        spacesApi.resolve(spaceId, nodeId, disposition),
        resolveSpacesApiBase(),
      ]);
      await openExternalLink(`${base}${ticket.url}`);
    },

    saveStudio: async (spaceId, kind, item) => {
      set({ error: null });
      try {
        const saved = await spacesApi.saveStudio(spaceId, kind, item);
        await get().loadStudio(spaceId, kind);
        return saved;
      } catch (error) {
        set({ error: errorText(error) });
        throw error;
      }
    },

    deleteStudio: async (spaceId, kind, id) => {
      set({ error: null });
      try {
        await spacesApi.deleteStudio(spaceId, kind, id);
        await get().loadStudio(spaceId, kind);
      } catch (error) {
        set({ error: errorText(error) });
        throw error;
      }
    },

    runStudio: async (spaceId, kind, id, prompt = "", capabilityId = "") => {
      try {
        return await spacesApi.runStudio(spaceId, kind, id, prompt, capabilityId);
      } catch (error) {
        set({ error: errorText(error) });
        throw error;
      }
    },

    markInboxSeen: async () => {
      await spacesApi.seen();
      set((state) => ({
        inbox: {
          unreads: state.inbox.unreads.map((item) => ({
            ...item,
            seen_at: item.seen_at ?? new Date().toISOString(),
          })),
          mentions: state.inbox.mentions.map((item) => ({
            ...item,
            seen_at: item.seen_at ?? new Date().toISOString(),
          })),
        },
      }));
    },

    clearInbox: async (tab) => {
      await spacesApi.clearInbox(tab);
      set((state) => ({ inbox: { ...state.inbox, [tab]: [] } }));
    },
  };
}
