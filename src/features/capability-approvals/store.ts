import { create } from "zustand";
import { capabilityApprovalsApi, type CapabilityApprovalSummary } from "./api";
import type { ActivityItem } from "@/features/activity/types";

interface ApprovalStore {
  accountId: string;
  items: CapabilityApprovalSummary[];
  nextCursor: string;
  loading: boolean;
  loaded: boolean;
  error: string;
  setAccount(id: string): void;
  refresh(): Promise<void>;
  loadMore(): Promise<void>;
}
let generation = 0;
let controller: AbortController | undefined;
export const useCapabilityApprovals = create<ApprovalStore>((set, get) => {
  const load = async (more: boolean) => {
    const state = get();
    if (!state.accountId || state.loading || (more && !state.nextCursor)) return;
    const current = generation;
    const request = new AbortController();
    controller = request;
    set({ loading: true, error: "" });
    try {
      const page = await capabilityApprovalsApi.list(more ? state.nextCursor : "", request.signal);
      if (current !== generation || request.signal.aborted) return;
      const items = more
        ? [
            ...state.items,
            ...page.approvals.filter(
              (item) => !state.items.some((existing) => existing.id === item.id),
            ),
          ]
        : page.approvals;
      set({ items, nextCursor: page.nextCursor ?? "", loaded: true });
    } catch {
      if (current === generation && !request.signal.aborted)
        set({ error: "Approvals could not be refreshed. Check your connection and try again." });
    } finally {
      if (current === generation) set({ loading: false });
    }
  };
  return {
    accountId: "",
    items: [],
    nextCursor: "",
    loading: false,
    loaded: false,
    error: "",
    setAccount(accountId) {
      if (get().accountId === accountId) return;
      generation++;
      controller?.abort();
      set({ accountId, items: [], nextCursor: "", loading: false, loaded: false, error: "" });
    },
    refresh: () => load(false),
    loadMore: () => load(true),
  };
});

export function capabilityApprovalActivities(
  accountId: string,
  items: CapabilityApprovalSummary[],
): ActivityItem[] {
  return items.map((item) => ({
    id: `capability-approval:${accountId}:${item.id}`,
    accountId,
    source: "capabilities",
    sourceId: item.id,
    kind: "approval",
    lifecycle: "request",
    sourceLabel: "Misty",
    title: "Action needs your approval",
    body: item.summary,
    createdAt: item.created_at,
    attention: true,
    target: { kind: "route", href: `/activity?approval=${encodeURIComponent(item.id)}` },
  }));
}
