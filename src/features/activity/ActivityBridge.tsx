import { observeAccountChanges } from "@/api/accountEvents";
import { useOperationActivity } from "./useOperationActivity";
import { useAuth } from "@/features/auth";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { syncNativeBadge } from "./nativeNotifications";
import {
  capabilityApprovalActivities,
  useCapabilityApprovals,
} from "@/features/capability-approvals/store";
import {
  agentInterventionActivities,
  useAgentInterventions,
} from "@/features/agent-interventions/store";
import { useActivityStore } from "./useActivityStore";

/**
 * Keeps notification sources and native delivery in sync without owning any UI.
 * Destination surfaces render and clear their own contextual badges.
 */
export function ActivityBridge() {
  const { user, transitioning } = useAuth();
  const accountId = transitioning ? "" : (user?.id ?? "");
  useOperationActivity(accountId);
  const approvals = useCapabilityApprovals();
  const interventions = useAgentInterventions();
  const { attentionCount, setAccount, syncSources, refresh, setOffline } = useActivityStore(
    useShallow((state) => ({
      attentionCount: state.attentionCount,
      setAccount: state.setAccount,
      syncSources: state.syncSources,
      refresh: state.refresh,
      setOffline: state.setOffline,
    })),
  );

  useEffect(() => {
    setAccount(accountId);
    const store = useCapabilityApprovals.getState();
    store.setAccount(accountId);
    useAgentInterventions.getState().setAccount(accountId);
    const remove = observeAccountChanges(
      accountId,
      ["approvals", "interventions", "invocations"],
      refresh,
    );
    return () => {
      remove();
      setAccount("");
      useCapabilityApprovals.getState().setAccount("");
      useAgentInterventions.getState().setAccount("");
    };
  }, [accountId, refresh, setAccount]);

  useEffect(() => {
    if (!accountId || useActivityStore.getState().accountId !== accountId) return;
    syncSources(
      accountId,
      [
        ...(interventions.accountId === accountId
          ? agentInterventionActivities(accountId, interventions.items)
          : []),
        ...(approvals.accountId === accountId
          ? capabilityApprovalActivities(accountId, approvals.items)
          : []),
      ],
      [
        ...(approvals.loaded && !approvals.loading && !approvals.error && !approvals.nextCursor
          ? ["capabilities" as const]
          : []),
        ...(interventions.loaded && !interventions.loading && !interventions.error
          ? ["interventions" as const]
          : []),
      ],
    );
  }, [
    accountId,
    syncSources,
    interventions.accountId,
    interventions.items,
    approvals.accountId,
    approvals.items,
    approvals.loaded,
    approvals.loading,
    approvals.error,
    approvals.nextCursor,
    interventions.loaded,
    interventions.loading,
    interventions.error,
  ]);

  useEffect(() => {
    const online = () => {
      setOffline(false);
      void refresh();
    };
    const offline = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    setOffline(!navigator.onLine);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [accountId, refresh, setOffline]);

  useEffect(() => {
    void syncNativeBadge(attentionCount);
  }, [attentionCount]);

  return null;
}
