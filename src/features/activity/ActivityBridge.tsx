import { useOperationActivity } from "./useOperationActivity";
import { useAuth } from "@/features/auth";
import { useSpacesStore } from "@/features/spaces";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { activityItemsFromSpaces } from "./activityModel";
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
  const { user } = useAuth();
  const accountId = user?.id ?? "";
  useOperationActivity(accountId);
  const approvals = useCapabilityApprovals();
  const interventions = useAgentInterventions();
  const [sourceReadyAccount, setSourceReadyAccount] = useState("");
  const { inbox, invitations, snapshotReady, referenceOnly, spacesLoading, spacesError } =
    useSpacesStore(
      useShallow((state) => ({
        inbox: state.inbox,
        invitations: state.invitations,
        snapshotReady: state.snapshotReady,
        referenceOnly: state.referenceOnly,
        spacesLoading: state.loading,
        spacesError: state.error,
      })),
    );
  const { attentionCount, setAccount, syncSources, load, refresh, setOffline } = useActivityStore(
    useShallow((state) => ({
      attentionCount: state.attentionCount,
      setAccount: state.setAccount,
      syncSources: state.syncSources,
      load: state.load,
      refresh: state.refresh,
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
        if (active && !useActivityStore.getState().offline && !useActivityStore.getState().error)
          setSourceReadyAccount(accountId);
      });
    }
    return () => {
      active = false;
    };
  }, [accountId, load, setAccount]);

  useEffect(() => {
    if (!accountId || useActivityStore.getState().accountId !== accountId) return;
    syncSources(
      accountId,
      [
        ...activityItemsFromSpaces(
          accountId,
          sourceReadyAccount === accountId ? inbox : { unreads: [], mentions: [] },
          snapshotReady && !referenceOnly ? invitations : [],
        ),
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
        ...(snapshotReady && !referenceOnly && !spacesLoading && !spacesError
          ? ["invitation" as const]
          : []),
      ],
      sourceReadyAccount === accountId ? ["spaces"] : [],
    );
  }, [
    accountId,
    inbox,
    invitations,
    snapshotReady,
    referenceOnly,
    spacesLoading,
    spacesError,
    sourceReadyAccount,
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
      void refresh().then(() => {
        const current = useActivityStore.getState();
        if (current.accountId === accountId && !current.offline && !current.error)
          setSourceReadyAccount(accountId);
      });
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
