import { applyAgentRunEvent } from "./agent-run-events";
import * as referenceMode from "./reference-mode";
import * as accessErrors from "@/api/spaces/access-errors";
import { mergeSpaceMessages, messageFromSpaceEvent } from "@/features/spaces/chat";
import { resolveSpacesApiBase, SpaceRequestError, spacesApi } from "@/api/spaces/api";
import type { SpaceEvent } from "@/api/spaces/dto/interfaces/types";
import { readRealtimeCursor, writeRealtimeCursor } from "@/api/spaces/realtime-cursor";
import { errorText } from "@/shared/lib/format";
import type { SpacesStore } from "../model/stores/spaces/interfaces/useSpacesStore";
import type { RealtimeEnvelope } from "../model/stores/spaces/types/useSpacesBackendStore";
export { buildMessageSpans } from "@/features/spaces/chat";

const realtimeConnectTimeoutMs = 12_000;
const realtimeTicketRateLimitCooldownMs = 30_000;
let realtimeSocket: WebSocket | null = null;
let realtimeConnecting = false;
let reconnectTimer: number | null = null;
let realtimeOpenTimer: number | null = null;
let realtimeConnectPromise: Promise<void> | null = null;
let realtimeTicketCooldownUntil = 0;
let reconnectAttempt = 0;
let realtimeWanted = false;
let realtimeAccountId = "";
let realtimeGeneration = 0;
let currentViewingSpaceId = "";
let readAccountGeneration = () => 0;
let currentViewingActive = computeViewingActivity();

type SpacesSet = (
  partial: Partial<SpacesStore> | ((state: SpacesStore) => Partial<SpacesStore>),
) => void;
export function createSpacesRealtimeActions(
  set: SpacesSet,
  get: () => SpacesStore,
  readGeneration: () => number,
): Pick<SpacesStore, "connectRealtime" | "disconnectRealtime" | "setViewingSpace"> {
  readAccountGeneration = readGeneration;
  return {
    connectRealtime: async (accountId) => {
      accountId = accountId.trim();
      if (!accountId) return;
      referenceMode.setSpaceReferenceModeAccount(accountId);
      if (realtimeAccountId && realtimeAccountId !== accountId) stopRealtimeConnection();
      realtimeAccountId = accountId;
      realtimeWanted = true;
      if (realtimeConnectPromise) return realtimeConnectPromise;
      if (Date.now() < realtimeTicketCooldownUntil) return;
      if (
        realtimeConnecting ||
        realtimeSocket?.readyState === WebSocket.OPEN ||
        realtimeSocket?.readyState === WebSocket.CONNECTING
      )
        return;
      realtimeConnecting = true;
      const generation = realtimeGeneration;
      const request = (async () => {
        try {
          const after = readRealtimeCursor(accountId);
          const [{ ticket }, base] = await Promise.all([
            spacesApi.realtimeTicket(after),
            resolveSpacesApiBase(),
          ]);
          if (
            !realtimeWanted ||
            generation !== realtimeGeneration ||
            realtimeAccountId !== accountId
          )
            return;
          realtimeTicketCooldownUntil = 0;
          const url = new URL(base);
          url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
          url.pathname = `${url.pathname.replace(/\/$/, "")}/realtime`;
          url.search = new URLSearchParams({ ticket }).toString();
          // Older WebKit builds accept URL in the type signature but can reject the
          // URL object at runtime. Pass the serialized URL to keep desktop WebViews
          // on the well-supported WebSocket constructor path.
          const socket = new WebSocket(url.toString());
          realtimeSocket = socket;
          realtimeOpenTimer = window.setTimeout(() => {
            realtimeOpenTimer = null;
            if (realtimeSocket === socket && socket.readyState === WebSocket.CONNECTING)
              socket.close();
          }, realtimeConnectTimeoutMs);
          socket.onopen = () => {
            if (
              realtimeSocket !== socket ||
              generation !== realtimeGeneration ||
              realtimeAccountId !== accountId
            ) {
              socket.close();
              return;
            }
            clearRealtimeOpenTimer();
            reconnectAttempt = 0;
            set({ realtimeConnected: true, error: null });
            if (get().referenceOnly) void get().load({ force: true, accountId });
            if (currentViewingSpaceId)
              sendViewingMessage(currentViewingSpaceId, currentViewingActive);
          };
          socket.onmessage = (message) => {
            if (
              realtimeSocket !== socket ||
              generation !== realtimeGeneration ||
              realtimeAccountId !== accountId
            )
              return;
            try {
              const envelope = JSON.parse(String(message.data)) as RealtimeEnvelope;
              if (envelope.type === "replay") {
                for (const event of envelope.events)
                  applyRealtimeEventSafely(event, accountId, get, set);
                if (envelope.resync_required)
                  void Promise.all([get().load({ force: true }), get().loadInbox()]);
              } else if (envelope.type === "event") {
                applyRealtimeEventSafely(envelope.event, accountId, get, set);
              } else if (envelope.type === "presence") {
                set((state) => ({
                  presenceBySpace: {
                    ...state.presenceBySpace,
                    [envelope.space_id]: envelope.viewers,
                  },
                }));
              } else {
                void Promise.all([get().load({ force: true }), get().loadInbox()]);
              }
            } catch {
              /* malformed server frames are ignored and recovered on reconnect */
            }
          };
          socket.onclose = () => {
            if (
              realtimeSocket !== socket ||
              generation !== realtimeGeneration ||
              realtimeAccountId !== accountId
            )
              return;
            clearRealtimeOpenTimer();
            realtimeSocket = null;
            set({ realtimeConnected: false });
            scheduleReconnect(get, accountId, generation);
          };
          socket.onerror = () => {
            try {
              socket.close();
            } catch {
              /* the close event or timeout will retry */
            }
          };
        } catch (error) {
          if (generation !== realtimeGeneration || realtimeAccountId !== accountId) return;
          if (error instanceof SpaceRequestError && error.status === 429) {
            realtimeTicketCooldownUntil = Date.now() + realtimeTicketRateLimitCooldownMs;
          }
          set({ realtimeConnected: false, error: errorText(error) });
          scheduleReconnect(get, accountId, generation);
        } finally {
          if (generation === realtimeGeneration && realtimeAccountId === accountId)
            realtimeConnecting = false;
        }
      })();
      realtimeConnectPromise = request;
      try {
        await request;
      } finally {
        if (realtimeConnectPromise === request) realtimeConnectPromise = null;
      }
    },

    disconnectRealtime: () => {
      stopRealtimeConnection();
      set({ realtimeConnected: false });
    },

    setViewingSpace: (spaceId) => {
      if (currentViewingSpaceId === spaceId) return;
      currentViewingSpaceId = spaceId;
      sendViewingMessage(spaceId, currentViewingActive);
    },
  };
}

export function resetSpacesRealtimeRuntime(): void {
  stopRealtimeConnection();
  reconnectAttempt = 0;
  realtimeConnectPromise = null;
  realtimeTicketCooldownUntil = 0;
}

export async function applyRealtimeEvent(
  event: SpaceEvent,
  accountId: string,
  get: () => SpacesStore,
  set: (partial: Partial<SpacesStore> | ((state: SpacesStore) => Partial<SpacesStore>)) => void,
) {
  if (accountId !== realtimeAccountId) return;
  const generation = readAccountGeneration();
  writeRealtimeCursor(accountId, event.id);
  const permissions = get().spaces.find((space) => space.id === event.space_id)?.permissions;
  if (event.type.startsWith("message.") && permissions?.["messages.read"] !== false) {
    const includedMessage = messageFromSpaceEvent(event);
    const conversationId =
      typeof event.payload.conversation_id === "string" ? event.payload.conversation_id : "";
    window.dispatchEvent(
      new CustomEvent("misty:space-message-event", {
        detail: { spaceId: event.space_id, conversationId, event },
      }),
    );
    if (conversationId) await get().loadInbox();
    else if (includedMessage) {
      set((state) => ({
        messagesBySpace: {
          ...state.messagesBySpace,
          [event.space_id]: mergeSpaceMessages(state.messagesBySpace[event.space_id] ?? [], [
            includedMessage,
          ]),
        },
      }));
      await get().loadInbox();
    } else await Promise.all([get().loadMessages(event.space_id), get().loadInbox()]);
  } else if (event.type.startsWith("agent.run.")) {
    applyAgentRunEvent(event, set);
    window.dispatchEvent(new CustomEvent("misty:space-agent-run-event", { detail: event }));
  } else if (event.type.startsWith("action_suggestion."))
    window.dispatchEvent(new CustomEvent("misty:space-action-suggestion-event", { detail: event }));
  else if (event.type.startsWith("conversation."))
    window.dispatchEvent(new CustomEvent("misty:space-conversation-event", { detail: event }));
  else if (event.type.startsWith("node.") && permissions?.["messages.read"] !== false)
    await get().loadNodes(event.space_id);
  else if (
    event.type.startsWith("member.") ||
    event.type.startsWith("owner.") ||
    event.type.startsWith("space.")
  ) {
    await get().load({ force: true });
    if (accountId !== realtimeAccountId || generation !== readAccountGeneration()) return;
    if (!get().spaces.some((space) => space.id === event.space_id)) return;
    try {
      await get().loadMembers(event.space_id);
    } catch (error) {
      if (!accessErrors.isInaccessibleSpaceError(error)) throw error;
    }
  } else if (event.type.startsWith("library.") && permissions?.["library.view"] !== false)
    window.dispatchEvent(new CustomEvent("misty:space-library-event", { detail: event }));
  else if (event.type.startsWith("note."))
    window.dispatchEvent(new CustomEvent("misty:space-note-event", { detail: event }));
  else if (event.type.startsWith("drawing."))
    window.dispatchEvent(new CustomEvent("misty:space-drawing-event", { detail: event }));
  else if (event.type.startsWith("roadmap.") && permissions?.["tasks.view"] !== false) {
    window.dispatchEvent(new CustomEvent("misty:space-roadmap-event", { detail: event }));
    window.dispatchEvent(new CustomEvent("misty:space-coordination-event", { detail: event }));
  } else if (
    (event.type.startsWith("task.") || event.type.startsWith("calendar.")) &&
    permissions?.["tasks.view"] !== false
  )
    window.dispatchEvent(new CustomEvent("misty:space-coordination-event", { detail: event }));
  set({ realtimeConnected: true });
}

export function applyRealtimeEventSafely(
  event: SpaceEvent,
  accountId: string,
  get: () => SpacesStore,
  set: (partial: Partial<SpacesStore> | ((state: SpacesStore) => Partial<SpacesStore>)) => void,
): void {
  void applyRealtimeEvent(event, accountId, get, set).catch((error) => {
    if (accessErrors.isInaccessibleSpaceError(error)) return;
    if (accountId !== realtimeAccountId) return;
    set({ error: errorText(error) });
  });
}

export function scheduleReconnect(get: () => SpacesStore, accountId: string, generation: number) {
  if (
    !realtimeWanted ||
    realtimeAccountId !== accountId ||
    realtimeGeneration !== generation ||
    reconnectTimer != null
  )
    return;
  const delay = Math.min(60_000, 2_000 * 2 ** reconnectAttempt) + Math.floor(Math.random() * 750);
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (!realtimeWanted || realtimeAccountId !== accountId || realtimeGeneration !== generation)
      return;
    void get().connectRealtime(accountId);
  }, delay);
}

export function stopRealtimeConnection() {
  realtimeWanted = false;
  realtimeConnecting = false;
  realtimeConnectPromise = null;
  realtimeTicketCooldownUntil = 0;
  realtimeAccountId = "";
  realtimeGeneration += 1;
  currentViewingSpaceId = "";
  if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
  clearRealtimeOpenTimer();
  const socket = realtimeSocket;
  realtimeSocket = null;
  socket?.close();
}

export function sendViewingMessage(spaceId: string, active: boolean): void {
  if (realtimeSocket?.readyState !== WebSocket.OPEN) return;
  try {
    realtimeSocket.send(JSON.stringify({ type: "viewing", space_id: spaceId, active }));
  } catch {
    /* the connection will retry and re-send on the next open */
  }
}

// "Active" means the Space is in view and the window has focus. Anything else
// counts as idle even though the WebSocket is still connected.
export function computeViewingActivity(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible" && document.hasFocus();
}

export function handleViewingActivityChange(): void {
  const active = computeViewingActivity();
  if (active === currentViewingActive) return;
  currentViewingActive = active;
  if (currentViewingSpaceId) sendViewingMessage(currentViewingSpaceId, currentViewingActive);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", handleViewingActivityChange);
  window.addEventListener("focus", handleViewingActivityChange);
  window.addEventListener("blur", handleViewingActivityChange);
}

export function clearRealtimeOpenTimer() {
  if (realtimeOpenTimer != null) window.clearTimeout(realtimeOpenTimer);
  realtimeOpenTimer = null;
}
