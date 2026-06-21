import { useActivityStore } from "@/features/activity/useActivityStore";
import { create } from "zustand";
import { agentInterventionsApi, interventionLabels, type AgentInterventionWait } from "./api";
import type { ActivityItem } from "@/features/activity/types";

type ObservedWait = AgentInterventionWait & { observedAt: string };
interface InterventionStore {
  accountId: string;
  items: ObservedWait[];
  loading: boolean;
  loaded: boolean;
  busy: string;
  error: string;
  setAccount(accountId: string): void;
  refresh(): Promise<void>;
  decide(accountId: string, id: string, ready: boolean): Promise<boolean>;
}
let generation = 0;
let read: AbortController | undefined;
let decision: AbortController | undefined;
export const useAgentInterventions = create<InterventionStore>((set, get) => ({
  accountId: "",
  items: [],
  loading: false,
  loaded: false,
  busy: "",
  error: "",
  setAccount(accountId) {
    if (accountId === get().accountId) return;
    generation++;
    read?.abort();
    decision?.abort();
    set({ accountId, items: [], loading: false, loaded: false, busy: "", error: "" });
  },
  async refresh() {
    const state = get();
    if (!state.accountId || state.loading || state.busy) return;
    const current = generation;
    const controller = new AbortController();
    read = controller;
    set({ loading: true });
    try {
      const page = await agentInterventionsApi.list(controller.signal);
      if (current !== generation || controller.signal.aborted) return;
      const observedAt = new Date().toISOString();
      const items = page.waits.map((wait) => ({
        ...wait,
        observedAt: state.items.find((item) => item.id === wait.id)?.observedAt ?? observedAt,
      }));
      set({ items, loaded: true, error: "" });
    } catch {
      if (current === generation && !controller.signal.aborted)
        set({
          error: "Browser requests could not be refreshed. Check your connection and try Refresh.",
        });
    } finally {
      if (current === generation && !controller.signal.aborted) set({ loading: false });
    }
  },
  async decide(accountId, id, ready) {
    const state = get();
    if (
      !accountId ||
      accountId !== state.accountId ||
      state.busy ||
      !state.items.some((item) => item.id === id)
    )
      return false;
    const current = generation;
    // An old GET must not reinsert a wait after its decision has been saved.
    read?.abort();
    const controller = new AbortController();
    decision = controller;
    set({ busy: id, loading: false, error: "" });
    let saved = false;
    try {
      await agentInterventionsApi.decide(id, ready, controller.signal);
      if (current !== generation || controller.signal.aborted) return false;
      useActivityStore.getState().resolveSourceRequest(accountId, "interventions", id);
      set({ items: get().items.filter((item) => item.id !== id) });
      saved = true;
    } catch {
      if (current === generation && !controller.signal.aborted)
        set({
          error: "Your response could not be confirmed. Refresh this request before trying again.",
        });
    } finally {
      if (current === generation && !controller.signal.aborted) set({ busy: "" });
    }
    if (saved) await get().refresh();
    return saved && current === generation;
  },
}));

export function agentInterventionActivities(
  accountId: string,
  items: ObservedWait[],
): ActivityItem[] {
  return items
    .filter((item) => Date.parse(item.expiresAt) > Date.now())
    .map((item) => ({
      id: `agent-intervention:${accountId}:${item.id}`,
      accountId,
      source: "interventions",
      sourceId: item.id,
      kind: "agent",
      lifecycle: "request",
      sourceLabel: "Misty",
      title: interventionLabels[item.action],
      // Keep website text and model-authored reasons out of system notifications.
      body: "Misty is waiting for you in the original browser. Review the request in Activity.",
      createdAt: item.observedAt,
      attention: true,
      target: { kind: "route", href: `/activity?intervention=${encodeURIComponent(item.id)}` },
    }));
}
