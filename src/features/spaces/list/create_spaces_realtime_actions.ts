import { clearMemberAgents, useMemberAgents, type MemberAgentStatus } from "./member_agents";
import { dispatchRealtimeExtra, setRealtimeSender } from "./realtime_extras";
import { httpOutageRemainingMs } from "@/api/client/http";
import { applyRealtimeEventSafely } from "./apply_realtime_event";
import { coalescedReload, resetCoalescedReloads } from "./coalesced_reload";
import {
  doubtRealtimeCursor,
  readRealtimeCursor,
  resetRealtimeCursor,
  resetRealtimeCursors,
} from "../api/realtime_cursor";
import { refreshWatchedSpaceResources } from "../api/space_resource";
import { useSpaceRolesStore } from "../roles/use_space_roles";
import { forgetDeletedSpaceMessages } from "../chat/use_space_message_spans_store";
import { clearVoicePresence, resetVoicePresence } from "./voice_presence";
import { resolveSpacesApiBase, SpaceRequestError, spacesApi } from "../api/api";
import { errorText } from "@/shared/lib/format";
import type { SpacesStore } from "./spaces_store_types";
import { spaceTypingScopeKey, type PresencePlace, type RealtimeEnvelope } from "./realtime_types";
import { spacesResyncEvent } from "./spaces_resync";
import { setSpacesConnection, useSpacesConnection } from "./spaces_connection";

const realtimeConnectTimeoutMs = 12_000;
const realtimeTicketRateLimitCooldownMs = 30_000;
const realtimeProbeWaitMs = 8_000;
const realtimeLongAwayMs = 90_000;
const realtimeSpaceListStaleMs = 3_000;
const typingShownMs = 4_000;
const realtimeQuietReplayAfterMs = 60_000;
const failedApplyResyncFirstMs = 1_000;
const failedApplyResyncMostMs = 30_000;
const failedApplyStreakResetMs = 60_000;
let failedApplyResync: { promise: Promise<void>; timer: number; settle: () => void } | null = null;
let failedApplyStreak = 0;
let failedApplyLastAt = 0;
let resyncWantsApps = false;
let realtimeReplayQuiet = true;
let realtimeHasConnected = false;
let realtimeProbeTimer: number | null = null;
let realtimeLastMessageAt = 0;
let realtimeDownSince = 0;
let hiddenSince = 0;
let realtimeGet: (() => SpacesStore) | null = null;
const typingTimers = new Map<string, number>();
let realtimeSocket: WebSocket | null = null;
let realtimeConnecting = false;
let reconnectTimer: number | null = null;
let realtimeOpenTimer: number | null = null;
let realtimeConnectPromise: Promise<void> | null = null;
let realtimeTicketCooldownUntil = 0;
let reconnectAttempt = 0;
const stableConnectionMs = 30_000;
let realtimeOpenedAt = 0;
let realtimeWanted = false;
let realtimeAccountId = "";
let realtimeGeneration = 0;
let currentViewingSpaceId = "";
let readAccountGeneration = () => 0;
let currentViewingActive = computeViewingActivity();
const realtimeScope = {
  currentAccountId: () => realtimeAccountId,
  accountGeneration: () => readAccountGeneration(),
  resync: () => (realtimeGet ? resyncSpaces(realtimeGet, { apps: true }) : Promise.resolve()),
  resyncAfterFailure: () => (realtimeGet ? resyncAfterFailedApply(realtimeGet) : Promise.resolve()),
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
  realtimeGet = get;
  return {
    connectRealtime: async (accountId) => {
      accountId = accountId.trim();
      if (!accountId) return;
      if (realtimeAccountId && realtimeAccountId !== accountId) stopRealtimeConnection();
      realtimeAccountId = accountId;
      realtimeWanted = true;
      if (realtimeConnectPromise) return realtimeConnectPromise;
      if (Date.now() < realtimeTicketCooldownUntil) {
        scheduleReconnect(get, accountId, realtimeGeneration);
        return;
      }
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
            realtimeLastMessageAt = realtimeOpenedAt;
            const downFor = realtimeDownSince ? realtimeOpenedAt - realtimeDownSince : 0;
            realtimeDownSince = 0;
            realtimeReplayQuiet = !realtimeHasConnected || downFor >= realtimeQuietReplayAfterMs;
            realtimeHasConnected = true;
            setSpacesConnection("connected");
            setRealtimeSender((payload) => {
              if (realtimeSocket !== socket || socket.readyState !== WebSocket.OPEN) return false;
              socket.send(payload);
              return true;
            });
            set({ error: null });
            const firstLoadRunning = !get().snapshotReady && get().loading;
            if (
              (!get().snapshotReady && !firstLoadRunning) ||
              get().referenceOnly ||
              downFor > realtimeSpaceListStaleMs
            )
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
            realtimeLastMessageAt = Date.now();
            try {
              const envelope = JSON.parse(String(message.data)) as RealtimeEnvelope;
              if (envelope.type === "replay") {
                for (const event of envelope.events)
                  applyRealtimeEventSafely(event, accountId, get, set, realtimeScope, {
                    quiet: realtimeReplayQuiet,
                  });
                if (envelope.resync_required) {
                  if (typeof envelope.newest_event_id === "number")
                    resetRealtimeCursor(accountId, envelope.newest_event_id);
                  else if (envelope.events.length === 0) doubtRealtimeCursor(accountId);
                  void resyncSpaces(get, { apps: true });
                }
              } else if (envelope.type === "control") {
                void resyncSpaces(get, { apps: false });
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
                const key = spaceTypingScopeKey(envelope.space_id, envelope.conversation_id);
                setTyping(set, key, envelope.user_id, envelope.active);
              } else {
                dispatchRealtimeExtra(envelope);
              }
            } catch {}
          };
          socket.onclose = () => {
            if (
              realtimeSocket !== socket ||
              generation !== realtimeGeneration ||
              realtimeAccountId !== accountId
            )
              return;
            clearRealtimeOpenTimer();
            clearRealtimeProbe();
            realtimeSocket = null;
            setRealtimeSender(null);
            if (!realtimeDownSince) realtimeDownSince = Date.now();
            forgetLiveValues(set);
            if (realtimeOpenedAt && Date.now() - realtimeOpenedAt >= stableConnectionMs)
              reconnectAttempt = 0;
            realtimeOpenedAt = 0;
            setSpacesConnection("reconnecting");
            scheduleReconnect(get, accountId, generation);
          };
          socket.onerror = () => {
            try {
              socket.close();
            } catch {}
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
      } catch {}
    },
  };
}

function resyncAfterFailedApply(get: () => SpacesStore): Promise<void> {
  if (failedApplyResync) return failedApplyResync.promise;
  const now = Date.now();
  if (now - failedApplyLastAt >= failedApplyStreakResetMs) failedApplyStreak = 0;
  failedApplyLastAt = now;
  const delay = Math.min(
    failedApplyResyncMostMs,
    failedApplyResyncFirstMs * 2 ** Math.min(failedApplyStreak, 5),
  );
  failedApplyStreak += 1;
  let settle = () => {};
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const pending = {
    promise,
    settle,
    timer: window.setTimeout(() => {
      void resyncSpaces(get, { apps: true })
        .catch(() => undefined)
        .finally(() => {
          if (failedApplyResync === pending) failedApplyResync = null;
          settle();
        });
    }, delay),
  };
  failedApplyResync = pending;
  return promise;
}

function cancelFailedApplyResync() {
  const pending = failedApplyResync;
  failedApplyResync = null;
  if (!pending) return;
  window.clearTimeout(pending.timer);
  pending.settle();
}

function resyncSpaces(get: () => SpacesStore, options: { apps: boolean }) {
  if (options.apps) resyncWantsApps = true;
  return coalescedReload("spaces-resync", async () => {
    const apps = resyncWantsApps;
    resyncWantsApps = false;
    await get().load({ force: true });
    const state = get();
    const known = new Set(state.spaces.map((space) => space.id));
    const quietly = (read: Promise<unknown>) => read.catch(() => undefined);
    const reads: Promise<unknown>[] = [quietly(refreshWatchedSpaceResources())];
    for (const spaceId of Object.keys(state.messagesBySpace))
      reads.push(quietly(coalescedReload(`messages:${spaceId}`, () => get().loadMessages(spaceId))));
    for (const spaceId of Object.keys(state.membersBySpace))
      if (known.has(spaceId))
        reads.push(quietly(coalescedReload(`members:${spaceId}`, () => get().loadMembers(spaceId))));
    for (const spaceId of Object.keys(state.nodesBySpace))
      if (known.has(spaceId))
        reads.push(quietly(coalescedReload(`nodes:${spaceId}`, () => get().loadNodes(spaceId))));
    for (const spaceId of Object.keys(useSpaceRolesStore.getState().bySpace))
      if (known.has(spaceId))
        reads.push(
          quietly(
            coalescedReload(`roles:${spaceId}`, () => useSpaceRolesStore.getState().load(spaceId)),
          ),
        );
    window.dispatchEvent(new Event(spacesResyncEvent));
    const pages: [string, string][] = [["misty:space-note-event", "note.resync"]];
    for (const space of state.spaces)
      for (const [page, type] of pages)
        window.dispatchEvent(
          new CustomEvent(page, { detail: { type, space_id: space.id, payload: {} } }),
        );
    if (apps)
      window.dispatchEvent(
        new CustomEvent("misty:space-apps-changed", {
          detail: { accountId: realtimeAccountId, spaceId: "" },
        }),
      );
    await Promise.all(reads);
  });
}

function setTyping(set: SpacesSet, key: string, userId: string, active: boolean) {
  const timerKey = `${key}\u0000${userId}`;
  const previous = typingTimers.get(timerKey);
  if (previous != null) window.clearTimeout(previous);
  typingTimers.delete(timerKey);
  if (active)
    typingTimers.set(
      timerKey,
      window.setTimeout(() => {
        typingTimers.delete(timerKey);
        setTyping(set, key, userId, false);
      }, typingShownMs),
    );
  set((state) => {
    const typingByUser = { ...(state.typingByConversation[key] ?? {}) };
    if (active) typingByUser[userId] = Date.now() + typingShownMs;
    else if (userId in typingByUser) delete typingByUser[userId];
    else return {};
    return { typingByConversation: { ...state.typingByConversation, [key]: typingByUser } };
  });
}

function clearTypingTimers() {
  for (const timer of typingTimers.values()) window.clearTimeout(timer);
  typingTimers.clear();
}

function forgetLiveValues(set: SpacesSet) {
  clearTypingTimers();
  set({ presenceBySpace: {}, typingByConversation: {} });
  clearVoicePresence();
  clearMemberAgents();
}

export function resetSpacesRealtimeRuntime(): void {
  stopRealtimeConnection();
  failedApplyStreak = 0;
  failedApplyLastAt = 0;
  resyncWantsApps = false;
  resetCoalescedReloads();
  resetRealtimeCursors();
  forgetDeletedSpaceMessages();
  resetVoicePresence();
  clearMemberAgents();
  clearTypingTimers();
  reconnectAttempt = 0;
  realtimeConnectPromise = null;
  realtimeTicketCooldownUntil = 0;
  realtimeDownSince = 0;
  realtimeHasConnected = false;
}

function scheduleReconnect(get: () => SpacesStore, accountId: string, generation: number) {
  if (
    !realtimeWanted ||
    realtimeAccountId !== accountId ||
    realtimeGeneration !== generation ||
    reconnectTimer != null
  )
    return;
  const ceiling = Math.min(60_000, 2_000 * 2 ** reconnectAttempt);
  const delay = Math.max(
    httpOutageRemainingMs(),
    realtimeTicketCooldownUntil - Date.now(),
    500 + Math.floor(Math.random() * ceiling),
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
  clearRealtimeProbe();
  cancelFailedApplyResync();
  const socket = realtimeSocket;
  realtimeSocket = null;
  socket?.close();
}

export function sendAgentStatuses(spaceId: string, agents: MemberAgentStatus[]): void {
  if (realtimeSocket?.readyState !== WebSocket.OPEN) return;
  try {
    realtimeSocket.send(JSON.stringify({ type: "agents", space_id: spaceId, agents }));
  } catch {}
}

let currentPlace: { spaceId: string; place: PresencePlace; itemId?: string } | null = null;

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

export function leaveViewingPlace(place: PresencePlace, itemId?: string): void {
  if (currentPlace?.place !== place) return;
  if (itemId !== undefined && (currentPlace.itemId ?? "") !== itemId) return;
  setViewingPlace(null);
}

function checkRealtimeAfterWake(): void {
  const get = realtimeGet;
  if (!realtimeWanted || !realtimeAccountId || !get) return;
  const socket = realtimeSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    if (realtimeConnecting || socket?.readyState === WebSocket.CONNECTING) return;
    if (Date.now() < realtimeTicketCooldownUntil) return;
    if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    void get().connectRealtime(realtimeAccountId);
    return;
  }
  if (realtimeProbeTimer != null) return;
  const spaces = get().spaces;
  if (!spaces.length) return;
  const probeSpaceId = spaces.some((space) => space.id === currentViewingSpaceId)
    ? currentViewingSpaceId
    : spaces[0].id;
  const askedAt = Date.now();
  try {
    socket.send(JSON.stringify({ type: "ping" }));
    socket.send(JSON.stringify({ type: "voice.sync", space_id: probeSpaceId }));
  } catch {
    return;
  }
  realtimeProbeTimer = window.setTimeout(() => {
    realtimeProbeTimer = null;
    if (realtimeSocket !== socket || socket.readyState !== WebSocket.OPEN) return;
    if (realtimeLastMessageAt >= askedAt) return;
    try {
      socket.close();
    } catch {}
  }, realtimeProbeWaitMs);
}

function clearRealtimeProbe() {
  if (realtimeProbeTimer != null) window.clearTimeout(realtimeProbeTimer);
  realtimeProbeTimer = null;
}

function handleRealtimeVisibility(): void {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "hidden") {
    if (!hiddenSince) hiddenSince = Date.now();
    return;
  }
  const away = hiddenSince ? Date.now() - hiddenSince : 0;
  hiddenSince = 0;
  if (away >= realtimeLongAwayMs) checkRealtimeAfterWake();
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
  } catch {}
}

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
  document.addEventListener("visibilitychange", handleRealtimeVisibility);
  window.addEventListener("focus", handleViewingActivityChange);
  window.addEventListener("blur", handleViewingActivityChange);
  window.addEventListener("online", checkRealtimeAfterWake);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) checkRealtimeAfterWake();
  });
}

function clearRealtimeOpenTimer() {
  if (realtimeOpenTimer != null) window.clearTimeout(realtimeOpenTimer);
  realtimeOpenTimer = null;
}
