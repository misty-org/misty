import { create } from "zustand";
import type { AgentInterventionWait } from "./api";
import {
  decideLocalWait,
  listenForLocalWaits,
  localWaits,
  onLocalWaitsChanged,
} from "./localWaits";

type ObservedWait = AgentInterventionWait & { observedAt: string };

/** The waits held on this computer, each keeping when it was first seen. */
function currentWaits(items: ObservedWait[]): ObservedWait[] {
  const observedAt = new Date().toISOString();
  return localWaits().map((wait) => ({
    ...wait,
    observedAt: items.find((item) => item.id === wait.id)?.observedAt ?? observedAt,
  }));
}

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

export const useAgentInterventions = create<InterventionStore>((set, get) => ({
  accountId: "",
  items: [],
  loading: false,
  loaded: false,
  busy: "",
  error: "",
  setAccount(accountId) {
    if (accountId === get().accountId) return;
    set({ accountId, items: currentWaits([]), loading: false, loaded: false, busy: "", error: "" });
  },
  async refresh() {
    set({ items: currentWaits(get().items), loaded: true, error: "" });
  },
  async decide(accountId, id, ready) {
    const state = get();
    if (!accountId || accountId !== state.accountId || !state.items.some((item) => item.id === id))
      return false;
    decideLocalWait(id, ready);
    set({ items: get().items.filter((item) => item.id !== id) });
    return true;
  },
}));
listenForLocalWaits();
onLocalWaitsChanged(() =>
  useAgentInterventions.setState((state) => ({ items: currentWaits(state.items) })),
);
