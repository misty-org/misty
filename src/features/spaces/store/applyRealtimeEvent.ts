import * as accessErrors from "@/api/spaces/access-errors";
import type { SpaceEvent } from "@/api/spaces/dto/entities";
import { writeRealtimeCursor } from "@/api/spaces/realtime-cursor";
import { errorText } from "@/shared/lib/format";
import { mergeSpaceMessages, messageFromSpaceEvent } from "../chat/store/useSpaceMessageSpansStore";
import { coalescedReload } from "./coalescedReload";
import type { SpacesStore } from "./spacesStoreTypes";

type SpacesSet = (
  partial: Partial<SpacesStore> | ((state: SpacesStore) => Partial<SpacesStore>),
) => void;
interface RealtimeScope {
  currentAccountId(): string;
  accountGeneration(): number;
}

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
    // Conversation threads load their own messages from the window event.
    if (!conversationId && includedMessage)
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
