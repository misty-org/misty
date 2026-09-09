import { useAuth } from "@/features/auth";
import { useSpacesStore } from "@/features/spaces";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { activityItemsFromSpaces, activityTargetMatchesLocation } from "./activityModel";
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
  const location = useLocation();
  const { user } = useAuth();
  const accountId = user?.id ?? "";
  const approvals = useCapabilityApprovals();
  const interventions = useAgentInterventions();
  const [sourceReadyAccount, setSourceReadyAccount] = useState("");
  const { inbox, invitations } = useSpacesStore(
    useShallow((state) => ({ inbox: state.inbox, invitations: state.invitations })),
  );
  const { allItems, attentionCount, setAccount, syncSources, load, refresh, markRead, setOffline } =
    useActivityStore(
      useShallow((state) => ({
        allItems: state.allItems,
        attentionCount: state.attentionCount,
        setAccount: state.setAccount,
        syncSources: state.syncSources,
        load: state.load,
        refresh: state.refresh,
        markRead: state.markRead,
        setOffline: state.setOffline,
      })),
    );

  useEffect(() => {
    const store = useCapabilityApprovals.getState();
    store.setAccount(accountId);
    useAgentInterventions.getState().setAccount(accountId);
    const refresh = () => {
      void useCapabilityApprovals.getState().refresh();
      void useAgentInterventions.getState().refresh();
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      useCapabilityApprovals.getState().setAccount("");
      useAgentInterventions.getState().setAccount("");
    };
  }, [accountId]);

  useEffect(() => {
    let active = true;
    setSourceReadyAccount("");
    setAccount(accountId);
    if (accountId) {
      void load().then(() => {
        if (active && !useActivityStore.getState().offline) setSourceReadyAccount(accountId);
      });
    }
    return () => {
      active = false;
    };
  }, [accountId, load, setAccount]);

  useEffect(() => {
    if (!accountId || sourceReadyAccount !== accountId) return;
    syncSources(accountId, [
      ...activityItemsFromSpaces(accountId, inbox, invitations),
      ...(interventions.accountId === accountId
        ? agentInterventionActivities(accountId, interventions.items)
        : []),
      ...(approvals.accountId === accountId
        ? capabilityApprovalActivities(accountId, approvals.items)
        : []),
    ]);
  }, [
    accountId,
    inbox,
    invitations,
    sourceReadyAccount,
    syncSources,
    interventions.accountId,
    interventions.items,
    approvals.accountId,
    approvals.items,
  ]);

  useEffect(() => {
    const online = () => {
      setOffline(false);
      void refresh().then(() => setSourceReadyAccount(accountId));
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
    for (const item of allItems) {
      if (!item.readAt && activityTargetMatchesLocation(item.target, location.pathname)) {
        markRead(item.id);
      }
    }
  }, [allItems, location.pathname, markRead]);

  useEffect(() => {
    void syncNativeBadge(attentionCount);
  }, [attentionCount]);

  return null;
}
