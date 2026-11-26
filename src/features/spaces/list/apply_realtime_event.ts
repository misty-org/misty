import { useSpaceRolesStore } from "../roles/use_space_roles";
import * as accessErrors from "../api/access_errors";
import type { SpaceEvent } from "../api/dto/entities";
import { beginRealtimeEvent, finishRealtimeEvent } from "../api/realtime_cursor";
import { errorText } from "@/shared/lib/format";
import { readAvatarDecoration } from "@/shared/lib/avatar_decoration";
import { useUserStore } from "@/features/account/core";
import {
  mergeSpaceMessages,
  messageFromSpaceEvent,
  noteDeletedSpaceMessage,
  patchedBySpaceEvent,
  withThreadReply,
  withoutThreadReply,
} from "../chat/use_space_message_spans_store";
import { coalescedReload } from "./coalesced_reload";
import { forwardDriveRealtimeEvent } from "../drive/drive_realtime";
import {
  applySpaceChatReadMarker,
  reloadSpaceConversations,
  reloadSpaceConversationsForMessage,
} from "../chat/space_conversations_resource";
import type { SpacesStore } from "./spaces_store_types";
import { spacesSnapshotLoadedSince, spacesSnapshotReloadQueued } from "./spaces_snapshot_freshness";
import { spaceReadEvent } from "./spaces_resync";

type SpacesSet = (
  partial: Partial<SpacesStore> | ((state: SpacesStore) => Partial<SpacesStore>),
) => void;
interface RealtimeScope {
  currentAccountId(): string;
  accountGeneration(): number;
  resync(): Promise<void>;
  resyncAfterFailure(): Promise<void>;
}

const realtimeApplyBoundMs = 30_000;

const itemEventPages: Record<string, string> = {
  note: "misty:space-note-event",
};

const agentEventTypes = new Set(["agent.added", "agent.updated", "agent.removed"]);

const spaceAgentsChanged = (spaceId: string) =>
  window.dispatchEvent(new CustomEvent("misty:space-agents-changed", { detail: { spaceId } }));

const avatarDecorationEvent = "misty:avatar-decoration";

function announceSpaceProfile(event: SpaceEvent) {
  if (event.type !== "space.updated") return;
  const detail: Record<string, unknown> = { spaceId: event.space_id };
  if (typeof event.payload.avatar_version === "number")
    detail.avatar_version = event.payload.avatar_version;
  if ("avatar_decoration" in event.payload)
    detail.avatar_decoration = readAvatarDecoration(event.payload.avatar_decoration);
  if (Object.keys(detail).length > 1)
    window.dispatchEvent(new CustomEvent("misty:space-profile", { detail }));
}

function applyAvatarDecoration(event: SpaceEvent, accountId: string, set: SpacesSet) {
  announceSpaceProfile(event);
  if (!("avatar_decoration" in event.payload)) return;
  const avatar_decoration = readAvatarDecoration(event.payload.avatar_decoration);
  if (event.type === "space.updated") {
    set((state) => ({
      spaces: state.spaces.map((space) =>
        space.id === event.space_id ? { ...space, avatar_decoration } : space,
      ),
    }));
    return;
  }
  const userId = event.payload.user_id;
  if (event.type !== "member.updated" || typeof userId !== "string" || !userId) return;
  set((state) => ({
    membersBySpace: Object.fromEntries(
      Object.entries(state.membersBySpace).map(([spaceId, members]) => [
        spaceId,
        members.some((member) => member.user_id === userId)
          ? members.map((member) =>
              member.user_id === userId ? { ...member, avatar_decoration } : member,
            )
          : members,
      ]),
    ),
  }));
  if (userId === accountId) useUserStore.getState().patchMe({ avatar_decoration });
  window.dispatchEvent(
    new CustomEvent(avatarDecorationEvent, { detail: { userId, avatar_decoration } }),
  );
}

async function reloadSpacesSnapshot(get: () => SpacesStore) {
  const askedAt = Date.now();
  await coalescedReload("spaces", () => get().load({ force: true }));
  if (!spacesSnapshotLoadedSince(askedAt) && !spacesSnapshotReloadQueued())
    throw new Error("The Space list could not be reloaded.");
}

async function applyRealtimeEvent(
  event: SpaceEvent,
  accountId: string,
  get: () => SpacesStore,
  set: SpacesSet,
  scope: RealtimeScope,
  quiet: boolean,
) {
  if (accountId !== scope.currentAccountId()) return;
  const generation = scope.accountGeneration();
  if (event.type.startsWith("drive.")) return forwardDriveRealtimeEvent(event);
  if (event.type.startsWith("agent_thread.")) {
    window.dispatchEvent(new CustomEvent("misty:agent-thread-event", { detail: event }));
    return;
  }
  if (agentEventTypes.has(event.type)) {
    spaceAgentsChanged(event.space_id);
    return;
  }
  if (event.type.startsWith("read.")) {
    if (event.actor_user_id && event.actor_user_id !== accountId) return;
    const conversationId =
      typeof event.payload.conversation_id === "string" ? event.payload.conversation_id : "";
    const inThread =
      typeof event.payload.thread_root_id === "string" && event.payload.thread_root_id !== "";
    const caughtUp =
      !inThread && readMarkerCaughtUp(get, event.space_id, conversationId, event.payload.seq);
    window.dispatchEvent(
      new CustomEvent(spaceReadEvent, {
        detail: { spaceId: event.space_id, conversationId, event, caughtUp },
      }),
    );
    if (!inThread) applySpaceChatReadMarker(event.space_id, conversationId, caughtUp);
    return;
  }
  if (event.type.startsWith("message.")) {
    const includedMessage = messageFromSpaceEvent(event);
    const conversationId =
      typeof event.payload.conversation_id === "string" ? event.payload.conversation_id : "";
    const deletedId =
      event.type === "message.deleted" && typeof event.payload.message_id === "string"
        ? event.payload.message_id
        : "";
    if (deletedId) noteDeletedSpaceMessage(deletedId);
    window.dispatchEvent(
      new CustomEvent("misty:space-message-event", {
        detail: { spaceId: event.space_id, conversationId, event, quiet },
      }),
    );
    if (event.type === "message.created" && !includedMessage?.thread_root_id)
      void reloadSpaceConversationsForMessage(event.space_id).catch(() => undefined);
    const deletedRootId =
      deletedId && typeof event.payload.thread_root_id === "string"
        ? event.payload.thread_root_id
        : "";
    const opened = event.space_id in get().messagesBySpace;
    if (!conversationId && deletedId)
      set((state) => {
        if (!(event.space_id in state.messagesBySpace)) return {};
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
      if (event.type === "message.created" && opened)
        set((state) => ({
          messagesBySpace: {
            ...state.messagesBySpace,
            [event.space_id]: withThreadReply(
              state.messagesBySpace[event.space_id] ?? [],
              includedMessage,
            ),
          },
        }));
    } else if (!conversationId && includedMessage) {
      if (opened)
        set((state) => ({
          messagesBySpace: {
            ...state.messagesBySpace,
            [event.space_id]: mergeSpaceMessages(state.messagesBySpace[event.space_id] ?? [], [
              includedMessage,
            ]),
          },
        }));
    } else if (!conversationId && opened) {
      const patched = patchedBySpaceEvent(
        get().messagesBySpace[event.space_id] ?? [],
        event,
        accountId,
      );
      if (patched)
        set((state) => ({
          messagesBySpace: {
            ...state.messagesBySpace,
            [event.space_id]:
              patchedBySpaceEvent(state.messagesBySpace[event.space_id] ?? [], event, accountId) ??
              state.messagesBySpace[event.space_id] ??
              [],
          },
        }));
      else
        await coalescedReload(`messages:${event.space_id}`, () =>
          get().loadMessages(event.space_id),
        );
    }
  } else if (event.type.startsWith("conversation.") || event.type.startsWith("channel_category."))
    window.dispatchEvent(new CustomEvent("misty:space-conversation-event", { detail: event }));
  else if (event.type.startsWith("direct."))
    window.dispatchEvent(new CustomEvent("misty:direct-event", { detail: event }));
  else if (event.type.startsWith("node.")) {
    if (event.space_id in get().nodesBySpace)
      await coalescedReload(`nodes:${event.space_id}`, () => get().loadNodes(event.space_id));
  } else if (event.type.startsWith("role.") || event.type.startsWith("roles.")) {
    spaceAgentsChanged(event.space_id);
    await coalescedReload(`roles:${event.space_id}`, () =>
      useSpaceRolesStore.getState().load(event.space_id),
    );
    await reloadSpacesSnapshot(get);
    void Promise.resolve(reloadSpaceConversations(event.space_id)).catch(() => undefined);
  } else if (
    event.type.startsWith("member.") ||
    event.type.startsWith("owner.") ||
    event.type.startsWith("space.")
  ) {
    applyAvatarDecoration(event, accountId, set);
    await reloadSpacesSnapshot(get);
    if (accountId !== scope.currentAccountId() || generation !== scope.accountGeneration()) return;
    if (!get().spaces.some((space) => space.id === event.space_id)) return;
    if (event.type.startsWith("member."))
      void Promise.resolve(reloadSpaceConversations(event.space_id)).catch(() => undefined);
    if (event.type.startsWith("member.") && event.payload.user_id === accountId)
      spaceAgentsChanged(event.space_id);
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
    else if (event.payload.kind === "node" && event.space_id in get().nodesBySpace)
      await coalescedReload(`nodes:${event.space_id}`, () => get().loadNodes(event.space_id));
  }
}

function readMarkerCaughtUp(
  get: () => SpacesStore,
  spaceId: string,
  conversationId: string,
  seq: unknown,
): boolean {
  if (typeof seq !== "number" || conversationId) return false;
  let newest = 0;
  for (const message of get().messagesBySpace[spaceId] ?? [])
    if (!message.thread_root_id && !message.local_delivery_state && message.seq > newest)
      newest = message.seq;
  return newest > 0 && seq >= newest;
}

function boundedApply(run: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("A Space update took too long to apply.")),
      realtimeApplyBoundMs,
    );
  });
  return Promise.race([run, bound]).finally(() => clearTimeout(timer));
}

export function applyRealtimeEventSafely(
  event: SpaceEvent,
  accountId: string,
  get: () => SpacesStore,
  set: SpacesSet,
  scope: RealtimeScope,
  options: { quiet?: boolean } = {},
): void {
  if (!beginRealtimeEvent(accountId, event.id)) return;
  const finish = () => finishRealtimeEvent(accountId, event.id);
  void boundedApply(
    applyRealtimeEvent(event, accountId, get, set, scope, options.quiet === true),
  ).then(finish, (error) => {
    if (accessErrors.isInaccessibleSpaceError(error) || accountId !== scope.currentAccountId())
      return finish();
    set({ error: errorText(error) });
    void boundedApply(scope.resyncAfterFailure()).then(finish, finish);
  });
}
