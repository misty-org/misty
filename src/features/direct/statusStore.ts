import { useEffect } from "react";
import { create } from "zustand";
import { onRealtimeMessage, onRealtimeOpen, sendRealtimeMessage } from "@/features/spaces";
import { useDoNotDisturb } from "@/shared/lib/doNotDisturb";
import { directApi, type AccountStatus, type ChosenStatus, type PresenceStatus } from "./api";

/** Mirrors Do not disturb for features that can't import this one (agents' run notices). */
function mirrorDoNotDisturb(status: ChosenStatus) {
  const dnd = status.chosen === "dnd";
  if (useDoNotDisturb.getState().value !== dnd) useDoNotDisturb.getState().set(dnd);
}

/** Ten minutes with no input on this computer is Idle. */
const idleAfterMs = 10 * 60 * 1000;

interface StatusState {
  /** How each person the account may see shows, by user id. */
  byUser: Record<string, AccountStatus>;
  /** What the person chose for themself. */
  mine: ChosenStatus;
  /** This computer has had no input for a while. */
  idle: boolean;
  load(): Promise<void>;
  receive(status: AccountStatus): void;
  setMine(status: ChosenStatus): Promise<void>;
}

export const useStatusStore = create<StatusState>((set, get) => ({
  byUser: {},
  mine: { chosen: "online" },
  idle: false,
  async load() {
    const [statuses, mine] = await Promise.all([directApi.statuses(), directApi.myStatus()]);
    set({
      byUser: Object.fromEntries(statuses.map((status) => [status.user_id, status])),
      mine,
    });
    mirrorDoNotDisturb(mine);
  },
  receive(status) {
    set((state) => ({ byUser: { ...state.byUser, [status.user_id]: status } }));
  },
  async setMine(status) {
    const previous = get().mine;
    set({ mine: status });
    mirrorDoNotDisturb(status);
    try {
      const saved = await directApi.setMyStatus(status);
      set({ mine: saved });
      mirrorDoNotDisturb(saved);
    } catch (error) {
      set({ mine: previous });
      mirrorDoNotDisturb(previous);
      throw error;
    }
  },
}));

/** How someone shows: their status from the server, offline until it has said otherwise. */
export function usePresence(userId: string | undefined): PresenceStatus {
  return useStatusStore((state) => (userId ? (state.byUser[userId]?.status ?? "offline") : "offline"));
}

/** Someone's custom status line, if they set one. */
export function useCustomStatus(userId: string | undefined): string {
  return useStatusStore((state) => {
    const status = userId ? state.byUser[userId] : undefined;
    return [status?.custom_emoji, status?.custom_text].filter(Boolean).join(" ");
  });
}

/** The person's own status as they show: their choice, Idle while this computer is idle. */
export function useMyPresence(): PresenceStatus {
  return useStatusStore((state) =>
    state.mine.chosen === "invisible"
      ? "offline"
      : state.mine.chosen === "dnd"
        ? "dnd"
        : state.idle
          ? "idle"
          : "online",
  );
}

/** Do not disturb silences notifications, sounds and ringing; unread marks stay. */
export function isDoNotDisturb(): boolean {
  return useStatusStore.getState().mine.chosen === "dnd";
}

/**
 * Keeps status live for the signed-in account, mounted once at the window's root: reads everyone's
 * status, takes changes from realtime, and tells the server when this computer goes idle (after
 * ten minutes with no input) or comes back.
 */
export function useStatusUpdates(accountId: string | undefined) {
  useEffect(() => {
    if (!accountId) return;
    const store = useStatusStore.getState();
    void store.load().catch(() => undefined);
    const stopStatus = onRealtimeMessage("status", (message) => {
      const status = message.status as AccountStatus | undefined;
      if (status?.user_id) useStatusStore.getState().receive(status);
    });
    const report = () => sendRealtimeMessage({ type: "activity", idle: useStatusStore.getState().idle });
    // A reconnect reads statuses afresh (changes while away were missed) and says whether idle.
    const stopOpen = onRealtimeOpen(() => {
      report();
      void useStatusStore.getState().load().catch(() => undefined);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const goIdle = () => {
      useStatusStore.setState({ idle: true });
      report();
    };
    const active = () => {
      clearTimeout(timer);
      timer = setTimeout(goIdle, idleAfterMs);
      if (useStatusStore.getState().idle) {
        useStatusStore.setState({ idle: false });
        report();
      }
    };
    const events = ["pointermove", "pointerdown", "keydown", "wheel", "focus"] as const;
    for (const name of events) window.addEventListener(name, active, { passive: true });
    active();
    return () => {
      clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, active);
      stopStatus();
      stopOpen();
      useStatusStore.setState({ byUser: {}, mine: { chosen: "online" }, idle: false });
    };
  }, [accountId]);
}
