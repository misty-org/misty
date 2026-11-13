import * as accessErrors from "../api/access-errors";
import type { SpaceEvent } from "../api/dto/entities";
import { writeRealtimeCursor } from "../api/realtime-cursor";
import { errorText } from "@/shared/lib/format";
import { mergeSpaceMessages, messageFromSpaceEvent } from "../chat/useSpaceMessageSpansStore";
import { coalescedReload } from "./coalescedReload";
import {
  reloadSpaceConversations,
  reloadSpaceConversationsForMessage,
} from "../chat/spaceConversationsResource";
import { realtimePlannerEvent } from "../planner/plannerEvents";
import type { SpacesStore } from "./spacesStoreTypes";

type SpacesSet = (
  partial: Partial<SpacesStore> | ((state: SpacesStore) => Partial<SpacesStore>),
) => void;
interface RealtimeScope {
  currentAccountId(): string;
  accountGeneration(): number;
}

/** Where an item's visibility change goes, by the item's kind. */
const itemEventPages: Record<string, string> = {
  library_item: "misty:space-library-event",
  note: "misty:space-note-event",
  drawing: "misty:space-drawing-event",
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
    // A new message changes a chat's unread count, which comes with the conversation list.
    if (event.type === "message.created")
      void reloadSpaceConversationsForMessage(event.space_id).catch(() => undefined);
    const deletedId =
      event.type === "message.deleted" && typeof event.payload.message_id === "string"
        ? event.payload.message_id
        : "";
    // Conversation threads load their own messages from the window event.
    if (!conversationId && deletedId)
      set((state) => ({
        messagesBySpace: {
          ...state.messagesBySpace,
          [event.space_id]: (state.messagesBySpace[event.space_id] ?? []).filter(
            (message) => message.id !== deletedId,
          ),
        },
      }));
    else if (!conversationId && includedMessage)
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
  else if (event.type.startsWith("node."))
    await coalescedReload(`nodes:${event.space_id}`, () => get().loadNodes(event.space_id));
  else if (
    event.type.startsWith("member.") ||
    event.type.startsWith("owner.") ||
    event.type.startsWith("space.")
  ) {
    await coalescedReload("spaces", () => get().load({ force: true }));
    if (accountId !== scope.currentAccountId() || generation !== scope.accountGeneration()) return;
    if (!get().spaces.some((space) => space.id === event.space_id)) return;
    // Who's in a channel changes with who's in the Space: a newcomer can be @mentioned there.
    if (event.type.startsWith("member."))
      void Promise.resolve(reloadSpaceConversations(event.space_id)).catch(() => undefined);
    try {
      await coalescedReload(`members:${event.space_id}`, () => get().loadMembers(event.space_id));
    } catch (error) {
      if (!accessErrors.isInaccessibleSpaceError(error)) throw error;
    }
  } else if (event.type.startsWith("library."))
    window.dispatchEvent(new CustomEvent("misty:space-library-event", { detail: event }));
  else if (event.type.startsWith("note."))
    window.dispatchEvent(new CustomEvent("misty:space-note-event", { detail: event }));
  else if (event.type.startsWith("drawing."))
    window.dispatchEvent(new CustomEvent("misty:space-drawing-event", { detail: event }));
  else if (event.type.startsWith("task.") || event.type.startsWith("calendar."))
    window.dispatchEvent(new CustomEvent(realtimePlannerEvent, { detail: event }));
  else if (event.type.startsWith("item.")) {
    // An item made private or public: the page that lists it reads again, so a private one leaves
    // other members' screens.
    const page = itemEventPages[String(event.payload.kind ?? "")];
    if (page) window.dispatchEvent(new CustomEvent(page, { detail: event }));
    else if (event.payload.kind === "node")
      await coalescedReload(`nodes:${event.space_id}`, () => get().loadNodes(event.space_id));
  }
}

/** Applies one realtime event; failures surface as the store error unless the Space is gone. */
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
