import { useSpaceRolesStore } from "../roles/use_space_roles";
import * as accessErrors from "../api/access_errors";
import type { SpaceEvent } from "../api/dto/entities";
import { writeRealtimeCursor } from "../api/realtime_cursor";
import { errorText } from "@/shared/lib/format";
import {
  mergeSpaceMessages,
  messageFromSpaceEvent,
  withThreadReply,
  withoutThreadReply,
} from "../chat/use_space_message_spans_store";
import { coalescedReload } from "./coalesced_reload";
import { forwardDriveRealtimeEvent } from "../drive/drive_realtime";
import {
  reloadSpaceConversations,
  reloadSpaceConversationsForMessage,
} from "../chat/space_conversations_resource";
import type { SpacesStore } from "./spaces_store_types";

type SpacesSet = (
  partial: Partial<SpacesStore> | ((state: SpacesStore) => Partial<SpacesStore>),
) => void;
interface RealtimeScope {
  currentAccountId(): string;
  accountGeneration(): number;
}

const itemEventPages: Record<string, string> = {
  note: "misty:space-note-event",
};

async function applyRealtimeEvent(
  event: SpaceEvent,
  accountId: string,
  get: () => SpacesStore,
  set: SpacesSet,
  scope: RealtimeScope,
) {
  if (accountId !== scope.currentAccountId()) return;
  const generation = scope.accountGeneration();
  writeRealtimeCursor(accountId, event.id);
  if (event.type.startsWith("drive.")) return forwardDriveRealtimeEvent(event);
  if (event.type === "apps.changed")
    window.dispatchEvent(
      new CustomEvent("misty:space-apps-changed", {
        detail: { accountId, spaceId: event.space_id },
      }),
    );
  if (event.type.startsWith("message.")) {
    const includedMessage = messageFromSpaceEvent(event);
    const conversationId =
      typeof event.payload.conversation_id === "string" ? event.payload.conversation_id : "";
    window.dispatchEvent(
      new CustomEvent("misty:space-message-event", {
        detail: { spaceId: event.space_id, conversationId, event },
      }),
    );
    if (event.type === "message.created" && !includedMessage?.thread_root_id)
      void reloadSpaceConversationsForMessage(event.space_id).catch(() => undefined);
    const deletedId =
      event.type === "message.deleted" && typeof event.payload.message_id === "string"
        ? event.payload.message_id
        : "";
    const deletedRootId =
      deletedId && typeof event.payload.thread_root_id === "string"
        ? event.payload.thread_root_id
        : "";
    if (!conversationId && deletedId)
      set((state) => {
        const kept = (state.messagesBySpace[event.space_id] ?? []).filter(
          (message) => message.id !== deletedId,
        );
        return {
          messagesBySpace: {
            ...state.messagesBySpace,
            [event.space_id]: deletedRootId ? withoutThreadReply(kept, deletedRootId) : kept,
          },
        };
      });
    else if (!conversationId && includedMessage?.thread_root_id) {
      if (event.type === "message.created")
        set((state) => ({
          messagesBySpace: {
            ...state.messagesBySpace,
            [event.space_id]: withThreadReply(
              state.messagesBySpace[event.space_id] ?? [],
              includedMessage,
            ),
          },
        }));
    } else if (!conversationId && includedMessage)
      set((state) => ({
        messagesBySpace: {
          ...state.messagesBySpace,
          [event.space_id]: mergeSpaceMessages(state.messagesBySpace[event.space_id] ?? [], [
            includedMessage,
          ]),
        },
      }));
    else if (!conversationId)
      await coalescedReload(`messages:${event.space_id}`, () => get().loadMessages(event.space_id));
  } else if (event.type.startsWith("conversation."))
    window.dispatchEvent(new CustomEvent("misty:space-conversation-event", { detail: event }));
  else if (event.type.startsWith("direct."))
    window.dispatchEvent(new CustomEvent("misty:direct-event", { detail: event }));
  else if (event.type.startsWith("node."))
    await coalescedReload(`nodes:${event.space_id}`, () => get().loadNodes(event.space_id));
  else if (event.type.startsWith("role.") || event.type.startsWith("roles.")) {
    await coalescedReload(`roles:${event.space_id}`, () =>
      useSpaceRolesStore.getState().load(event.space_id),
    );
    await coalescedReload("spaces", () => get().load({ force: true }));
    void Promise.resolve(reloadSpaceConversations(event.space_id)).catch(() => undefined);
  } else if (
    event.type.startsWith("member.") ||
    event.type.startsWith("owner.") ||
    event.type.startsWith("space.")
  ) {
    await coalescedReload("spaces", () => get().load({ force: true }));
    if (accountId !== scope.currentAccountId() || generation !== scope.accountGeneration()) return;
    if (!get().spaces.some((space) => space.id === event.space_id)) return;
    if (event.type.startsWith("member."))
      void Promise.resolve(reloadSpaceConversations(event.space_id)).catch(() => undefined);
    try {
      await coalescedReload(`members:${event.space_id}`, () => get().loadMembers(event.space_id));
    } catch (error) {
      if (!accessErrors.isInaccessibleSpaceError(error)) throw error;
    }
  } else if (event.type.startsWith("note."))
    window.dispatchEvent(new CustomEvent("misty:space-note-event", { detail: event }));
  else if (event.type.startsWith("item.")) {
    const page = itemEventPages[String(event.payload.kind ?? "")];
    if (page) window.dispatchEvent(new CustomEvent(page, { detail: event }));
    else if (event.payload.kind === "node")
      await coalescedReload(`nodes:${event.space_id}`, () => get().loadNodes(event.space_id));
  }
}

export function applyRealtimeEventSafely(
  event: SpaceEvent,
  accountId: string,
  get: () => SpacesStore,
  set: SpacesSet,
  scope: RealtimeScope,
): void {
  void applyRealtimeEvent(event, accountId, get, set, scope).catch((error) => {
    if (accessErrors.isInaccessibleSpaceError(error)) return;
    if (accountId !== scope.currentAccountId()) return;
    set({ error: errorText(error) });
  });
}
