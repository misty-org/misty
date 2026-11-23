import { useEffect } from "react";
import { create } from "zustand";
import { onRealtimeMessage, onRealtimeOpen, sendRealtimeMessage } from "@/features/spaces";
import { useDoNotDisturb } from "@/shared/lib/do_not_disturb";
import { directApi, type AccountStatus, type ChosenStatus, type PresenceStatus } from "./api";

function mirrorDoNotDisturb(status: ChosenStatus) {
  const dnd = status.chosen === "dnd";
  if (useDoNotDisturb.getState().value !== dnd) useDoNotDisturb.getState().set(dnd);
}

const idleAfterMs = 10 * 60 * 1000;
const longestTimerMs = 2_147_483_647;
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const mineKey = "\u0000mine";

function untilExpiry(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

function scheduleExpiry(key: string, expiresAt: string | null | undefined, expire: () => void) {
  const previous = expiryTimers.get(key);
  if (previous) clearTimeout(previous);
  expiryTimers.delete(key);
  const wait = untilExpiry(expiresAt);
  if (wait === null || wait > longestTimerMs) return;
  expiryTimers.set(
    key,
    setTimeout(() => {
      expiryTimers.delete(key);
      expire();
    }, wait),
  );
}

function clearExpiryTimers() {
  for (const timer of expiryTimers.values()) clearTimeout(timer);
  expiryTimers.clear();
}

function withoutCustom(status: AccountStatus): AccountStatus {
  return { ...status, custom_text: undefined, custom_emoji: undefined, custom_expires_at: null };
}

function withoutMyCustom(status: ChosenStatus): ChosenStatus {
  return { ...status, custom_text: undefined, custom_emoji: undefined, custom_expires_at: null };
}

const statusFields = ["chosen", "custom_text", "custom_emoji", "custom_expires_at"] as const;

interface StatusState {
  byUser: Record<string, AccountStatus>;
  mine: ChosenStatus;
  idle: boolean;
  load(): Promise<void>;
  receive(status: AccountStatus): void;
  receiveMine(status: ChosenStatus): void;
  setMine(status: Partial<ChosenStatus>): Promise<void>;
}

export const useStatusStore = create<StatusState>((set, get) => ({
  byUser: {},
  mine: { chosen: "online" },
  idle: false,
  async load() {
    const [statuses, mine] = await Promise.all([directApi.statuses(), directApi.myStatus()]);
    set({
      byUser: Object.fromEntries(statuses.map((status) => [status.user_id, status])),
    });
    for (const status of statuses) get().receive(status);
    get().receiveMine(mine);
  },
  receive(status) {
    set((state) => ({ byUser: { ...state.byUser, [status.user_id]: status } }));
    scheduleExpiry(status.user_id, status.custom_expires_at, () =>
      set((state) => {
        const current = state.byUser[status.user_id];
        if (!current || current.custom_expires_at !== status.custom_expires_at) return {};
        return { byUser: { ...state.byUser, [status.user_id]: withoutCustom(current) } };
      }),
    );
  },
  receiveMine(status) {
    set({ mine: status });
    mirrorDoNotDisturb(status);
    scheduleExpiry(mineKey, status.custom_expires_at, () => {
      const current = get().mine;
      if (current.custom_expires_at !== status.custom_expires_at) return;
      set({ mine: withoutMyCustom(current) });
    });
  },
  async setMine(status) {
    const previous = get().mine;
    const fields = statusFields.filter(
      (field) => field in status && (status[field] ?? "") !== (previous[field] ?? ""),
    );
    if (!fields.length) return;
    const next: ChosenStatus = { ...previous };
    for (const field of fields) Object.assign(next, { [field]: status[field] });
    set({ mine: next });
    mirrorDoNotDisturb(next);
    try {
      const saved = await directApi.setMyStatus(next, fields);
      get().receiveMine(saved);
    } catch (error) {
      set({ mine: previous });
      mirrorDoNotDisturb(previous);
      throw error;
    }
  },
}));

export function usePresence(userId: string | undefined): PresenceStatus {
  return useStatusStore((state) =>
    userId ? (state.byUser[userId]?.status ?? "offline") : "offline",
  );
}

export function useCustomStatus(userId: string | undefined): string {
  return useStatusStore((state) => {
    const status = userId ? state.byUser[userId] : undefined;
    return [status?.custom_emoji, status?.custom_text].filter(Boolean).join(" ");
  });
}

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

export function isDoNotDisturb(): boolean {
  return useStatusStore.getState().mine.chosen === "dnd";
}

export function useStatusUpdates(accountId: string | undefined) {
  useEffect(() => {
    if (!accountId) return;
    const store = useStatusStore.getState();
    void store.load().catch(() => undefined);
    const stopStatus = onRealtimeMessage("status", (message) => {
      const status = message.status as AccountStatus | undefined;
      if (status?.user_id) useStatusStore.getState().receive(status);
    });
    const stopMine = onRealtimeMessage("status.mine", (message) => {
      const status = message.status as ChosenStatus | undefined;
      if (status?.chosen) useStatusStore.getState().receiveMine(status);
    });
    const report = () =>
      sendRealtimeMessage({ type: "activity", idle: useStatusStore.getState().idle });
    const stopOpen = onRealtimeOpen(() => {
      report();
      void useStatusStore
        .getState()
        .load()
        .catch(() => undefined);
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
      stopMine();
      stopOpen();
      clearExpiryTimers();
      useStatusStore.setState({ byUser: {}, mine: { chosen: "online" }, idle: false });
    };
  }, [accountId]);
}
