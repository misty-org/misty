import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "@/features/auth/AuthContext";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { activityItemsFromSpaces, activityTargetMatchesLocation } from "./activityModel";
import { syncNativeBadge } from "./nativeNotifications";
import { useActivityStore } from "./useActivityStore";

/**
 * Keeps notification sources and native delivery in sync without owning any UI.
 * Destination surfaces render and clear their own contextual badges.
 */
export function ActivityBridge() {
  const location = useLocation();
  const { user } = useAuth();
  const accountId = user?.id ?? "";
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
    syncSources(accountId, activityItemsFromSpaces(accountId, inbox, invitations));
  }, [accountId, inbox, invitations, sourceReadyAccount, syncSources]);

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
