import { create } from "zustand";
import { agentMemberRequestsApi, type AgentMemberRequest } from "./api";

interface MemberRequestStore {
  accountId: string;
  items: AgentMemberRequest[];
  loading: boolean;
  loaded: boolean;
  busy: string;
  error: string;
  setAccount(accountId: string): void;
  refresh(): Promise<void>;
  decide(accountId: string, id: string, approve: boolean): Promise<boolean>;
}

let generation = 0;
let read: AbortController | undefined;
let decision: AbortController | undefined;

/** Requests from other members' agents waiting for this account's approval. */
export const useAgentMemberRequests = create<MemberRequestStore>((set, get) => ({
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
      const page = await agentMemberRequestsApi.pending(controller.signal);
      if (current !== generation || controller.signal.aborted) return;
      set({ items: page.requests, loaded: true, error: "" });
    } catch {
      if (current === generation && !controller.signal.aborted)
        set({
          error: "Agent requests could not be refreshed. Check your connection and try again.",
        });
    } finally {
      if (current === generation && !controller.signal.aborted) set({ loading: false });
    }
  },
  async decide(accountId, id, approve) {
    const state = get();
    if (!accountId || accountId !== state.accountId || state.busy) return false;
    if (!state.items.some((item) => item.id === id)) return false;
    const current = generation;
    // An old read must not bring back a request after its decision is saved.
    read?.abort();
    const controller = new AbortController();
    decision = controller;
    set({ busy: id, loading: false, error: "" });
    let saved = false;
    try {
      await agentMemberRequestsApi.decide(id, approve, controller.signal);
      if (current !== generation || controller.signal.aborted) return false;
      set({ items: get().items.filter((item) => item.id !== id) });
      saved = true;
    } catch {
      if (current === generation && !controller.signal.aborted)
        set({ error: "Your answer could not be saved. Refresh this request and try again." });
    } finally {
      if (current === generation && !controller.signal.aborted) set({ busy: "" });
    }
    if (saved) await get().refresh();
    return saved && current === generation;
  },
}));
