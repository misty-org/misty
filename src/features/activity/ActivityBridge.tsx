import { observeAccountChanges } from "@/api/accountEvents";
import { useAuth } from "@/features/auth";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { syncNativeBadge } from "./nativeNotifications";
import {
  agentInterventionActivities,
  useAgentInterventions,
} from "@/features/agent-interventions/store";
import {
  agentMemberRequestActivities,
  useAgentMemberRequests,
} from "@/features/agent-member-requests/store";
import { useActivityStore } from "./useActivityStore";

/**
 * Keeps notification sources and native delivery in sync without owning any UI.
 * Destination surfaces render and clear their own contextual badges.
 */
export function ActivityBridge() {
  const { user, transitioning } = useAuth();
  const accountId = transitioning ? "" : (user?.id ?? "");
  const interventions = useAgentInterventions();
  const memberRequests = useAgentMemberRequests();
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
    useAgentInterventions.getState().setAccount(accountId);
    useAgentMemberRequests.getState().setAccount(accountId);
    // Each source re-reads only on its own topic. An invocation changing state
    // can only remove pending items (new ones publish their own topic), so it
    // re-reads only sources that currently hold items.
    const removeInterventions = observeAccountChanges(accountId, ["interventions"], () =>
      refresh(["interventions"]),
    );
    const removeMemberRequests = observeAccountChanges(accountId, ["agent_requests"], () =>
      refresh(["agent_requests"]),
    );
    const removeInvocations = observeAccountChanges(accountId, ["invocations"], () =>
      refresh([
        ...(useAgentInterventions.getState().items.length ? (["interventions"] as const) : []),
      ]),
    );
    return () => {
      removeInterventions();
      removeMemberRequests();
      removeInvocations();
      setAccount("");
      useAgentInterventions.getState().setAccount("");
      useAgentMemberRequests.getState().setAccount("");
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
        ...(memberRequests.accountId === accountId
          ? agentMemberRequestActivities(accountId, memberRequests.items)
          : []),
      ],
      [
        ...(interventions.loaded && !interventions.loading && !interventions.error
          ? ["interventions" as const]
          : []),
        ...(memberRequests.loaded && !memberRequests.loading && !memberRequests.error
          ? ["agent_requests" as const]
          : []),
      ],
    );
  }, [
    accountId,
    syncSources,
    interventions.accountId,
    interventions.items,
    interventions.loaded,
    interventions.loading,
    interventions.error,
    memberRequests.accountId,
    memberRequests.items,
    memberRequests.loaded,
    memberRequests.loading,
    memberRequests.error,
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
