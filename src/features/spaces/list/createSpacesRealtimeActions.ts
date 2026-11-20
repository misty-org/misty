import { useMemberAgents, type MemberAgentStatus } from "./memberAgents";
import { dispatchRealtimeExtra, setRealtimeSender } from "./realtimeExtras";
import { httpOutageRemainingMs } from "@/api/client/http";
import { applyRealtimeEventSafely } from "./applyRealtimeEvent";
import { coalescedReload, resetCoalescedReloads } from "./coalescedReload";
import { readRealtimeCursor } from "../api/realtime-cursor";
import { resolveSpacesApiBase, SpaceRequestError, spacesApi } from "../api/api";
import { errorText } from "@/shared/lib/format";
import type { SpacesStore } from "./spacesStoreTypes";
import { spaceTypingScopeKey, type PresencePlace, type RealtimeEnvelope } from "./realtimeTypes";
import { spacesResyncEvent } from "./spacesResync";
import { setSpacesConnection, useSpacesConnection } from "./spacesConnection";

const realtimeConnectTimeoutMs = 12_000;
const realtimeTicketRateLimitCooldownMs = 30_000;
let realtimeSocket: WebSocket | null = null;
let realtimeConnecting = false;
let reconnectTimer: number | null = null;
let realtimeOpenTimer: number | null = null;
let realtimeConnectPromise: Promise<void> | null = null;
let realtimeTicketCooldownUntil = 0;
let reconnectAttempt = 0;
// Backoff resets only after a connection proves stable, so a socket that
// opens and immediately drops keeps backing off instead of retrying at 2s.
const stableConnectionMs = 30_000;
let realtimeOpenedAt = 0;
let realtimeWanted = false;
let realtimeAccountId = "";
let realtimeGeneration = 0;
let currentViewingSpaceId = "";
let readAccountGeneration = () => 0;
let currentViewingActive = computeViewingActivity();
// What a realtime event checks before it writes, so a late event never lands in another account.
const realtimeScope = {
  currentAccountId: () => realtimeAccountId,
  accountGeneration: () => readAccountGeneration(),
};

type SpacesSet = (
  partial: Partial<SpacesStore> | ((state: SpacesStore) => Partial<SpacesStore>),
) => void;
export function createSpacesRealtimeActions(
  set: SpacesSet,
  get: () => SpacesStore,
  readGeneration: () => number,
): Pick<SpacesStore, "connectRealtime" | "disconnectRealtime" | "setViewingSpace" | "sendTyping"> {
  readAccountGeneration = readGeneration;
  return {
    connectRealtime: async (accountId) => {
      accountId = accountId.trim();
      if (!accountId) return;
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
      if (useSpacesConnection.getState().state === "off") setSpacesConnection("connecting");
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
            realtimeOpenedAt = Date.now();
            setSpacesConnection("connected");
            setRealtimeSender((payload) => {
              if (realtimeSocket !== socket || socket.readyState !== WebSocket.OPEN) return false;
              socket.send(payload);
              return true;
            });
            set((state) => ({ error: state.snapshotReady ? null : state.error }));
            if (!get().snapshotReady || get().referenceOnly)
              void get().load({ force: true, accountId });
            if (currentViewingSpaceId || currentPlace) sendViewing();
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
                  applyRealtimeEventSafely(event, accountId, get, set, realtimeScope);
                if (envelope.resync_required) void resyncSpaces(get);
              } else if (envelope.type === "event") {
                applyRealtimeEventSafely(envelope.event, accountId, get, set, realtimeScope);
              } else if (envelope.type === "presence") {
                set((state) => ({
                  presenceBySpace: {
                    ...state.presenceBySpace,
                    [envelope.space_id]: envelope.viewers,
                  },
                }));
              } else if (envelope.type === "agents") {
                useMemberAgents
                  .getState()
                  .receive(envelope.space_id, envelope.user_id, envelope.agents);
              } else if (envelope.type === "typing") {
                set((state) => {
                  const key = spaceTypingScopeKey(envelope.space_id, envelope.conversation_id);
                  const typingByUser = { ...(state.typingByConversation[key] ?? {}) };
                  if (envelope.active) typingByUser[envelope.user_id] = Date.now() + 4_000;
                  else delete typingByUser[envelope.user_id];
                  return {
                    typingByConversation: {
                      ...state.typingByConversation,
                      [key]: typingByUser,
                    },
                  };
                });
              } else if (!dispatchRealtimeExtra(envelope)) {
                void resyncSpaces(get);
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
            setRealtimeSender(null);
            if (realtimeOpenedAt && Date.now() - realtimeOpenedAt >= stableConnectionMs)
              reconnectAttempt = 0;
            realtimeOpenedAt = 0;
            setSpacesConnection("reconnecting");
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
          set({ error: errorText(error) });
          setSpacesConnection("reconnecting");
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
    },

    setViewingSpace: (spaceId) => {
      if (currentViewingSpaceId === spaceId) return;
      currentViewingSpaceId = spaceId;
      sendViewing();
    },
    sendTyping: (spaceId, conversationId, active) => {
      if (realtimeSocket?.readyState !== WebSocket.OPEN) return;
      try {
        realtimeSocket.send(
          JSON.stringify({
            type: "typing",
            space_id: spaceId,
            conversation_id: conversationId,
            active,
          }),
        );
      } catch {
        /* Typing is ephemeral; a missed event expires on other clients. */
      }
    },
  };
}

/**
 * The server lost track of what this app has seen (a long time offline, or more missed events
 * than it replays): the Space list, every Everyone chat already loaded and whatever else is open
 * (channels, direct chats, the library) fetch afresh, so nothing sent meanwhile stays missing.
 */
function resyncSpaces(get: () => SpacesStore) {
  return coalescedReload("spaces", async () => {
    await get().load({ force: true });
    for (const spaceId of Object.keys(get().messagesBySpace))
      void coalescedReload(`messages:${spaceId}`, () => get().loadMessages(spaceId));
    window.dispatchEvent(new Event(spacesResyncEvent));
    // Lab notebooks read again as on any change of theirs, for every Space.
    const pages: [string, string][] = [["misty:space-note-event", "note.resync"]];
    for (const space of get().spaces)
      for (const [page, type] of pages)
        window.dispatchEvent(
          new CustomEvent(page, { detail: { type, space_id: space.id, payload: {} } }),
        );
  });
}

export function resetSpacesRealtimeRuntime(): void {
  stopRealtimeConnection();
  resetCoalescedReloads();
  reconnectAttempt = 0;
  realtimeConnectPromise = null;
  realtimeTicketCooldownUntil = 0;
}

function scheduleReconnect(get: () => SpacesStore, accountId: string, generation: number) {
  if (
    !realtimeWanted ||
    realtimeAccountId !== accountId ||
    realtimeGeneration !== generation ||
    reconnectTimer != null
  )
    return;
  // Never reconnect sooner than the client's shared outage cooldown.
  const delay = Math.max(
    httpOutageRemainingMs(),
    Math.min(60_000, 2_000 * 2 ** reconnectAttempt) + Math.floor(Math.random() * 750),
  );
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (!realtimeWanted || realtimeAccountId !== accountId || realtimeGeneration !== generation)
      return;
    void get().connectRealtime(accountId);
  }, delay);
}

function stopRealtimeConnection() {
  setSpacesConnection("off");
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

/** Tells the Space's other members what this person's agents are doing now. */
export function sendAgentStatuses(spaceId: string, agents: MemberAgentStatus[]): void {
  if (realtimeSocket?.readyState !== WebSocket.OPEN) return;
  try {
    realtimeSocket.send(JSON.stringify({ type: "agents", space_id: spaceId, agents }));
  } catch {
    /* the next change or the next repeat sends it again */
  }
}

/**
 * Where in Misty the person is (the Studio, or a Lab notebook) and for which Space. The Studio and
 * the Lab aren't inside a Space's workspace, so a place brings its own Space: it is what the
 * person is viewing while no Space workspace is.
 */
let currentPlace: { spaceId: string; place: PresencePlace; itemId?: string } | null = null;

/** Says which place the person is in now, or none. Only the place's name and a doc id go out. */
export function setViewingPlace(
  next: { spaceId: string; place: PresencePlace; itemId?: string } | null,
): void {
  const same =
    currentPlace?.spaceId === next?.spaceId &&
    currentPlace?.place === next?.place &&
    currentPlace?.itemId === next?.itemId;
  if (same) return;
  currentPlace = next;
  sendViewing();
}

/** Leaves a place, unless the person has since gone somewhere else (another pane's page). */
export function leaveViewingPlace(place: PresencePlace, itemId?: string): void {
  if (currentPlace?.place !== place) return;
  if (itemId !== undefined && (currentPlace.itemId ?? "") !== itemId) return;
  setViewingPlace(null);
}

function sendViewing(): void {
  const spaceId = currentViewingSpaceId || currentPlace?.spaceId || "";
  if (realtimeSocket?.readyState !== WebSocket.OPEN) return;
  const place = currentPlace && currentPlace.spaceId === spaceId ? currentPlace : null;
  try {
    realtimeSocket.send(
      JSON.stringify({
        type: "viewing",
        space_id: spaceId,
        active: currentViewingActive,
        ...(place ? { place: place.place, item_id: place.itemId ?? "" } : {}),
      }),
    );
  } catch {
    /* the connection will retry and re-send on the next open */
  }
}

// "Active" means the Space is in view and the window has focus. Anything else
// counts as idle even though the WebSocket is still connected.
function computeViewingActivity(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible" && document.hasFocus();
}

function handleViewingActivityChange(): void {
  const active = computeViewingActivity();
  if (active === currentViewingActive) return;
  currentViewingActive = active;
  if (currentViewingSpaceId || currentPlace) sendViewing();
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", handleViewingActivityChange);
  window.addEventListener("focus", handleViewingActivityChange);
  window.addEventListener("blur", handleViewingActivityChange);
}

function clearRealtimeOpenTimer() {
  if (realtimeOpenTimer != null) window.clearTimeout(realtimeOpenTimer);
  realtimeOpenTimer = null;
}
