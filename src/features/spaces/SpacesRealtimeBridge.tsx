import { useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthContext";
import { useExplorerStore } from "@/stores/explorer";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";

export function SpacesRealtimeBridge() {
  const { user, transitioning } = useAuth();
  const load = useSpacesStore((state) => state.load);
  const loadInbox = useSpacesStore((state) => state.loadInbox);
  const connectRealtime = useSpacesStore((state) => state.connectRealtime);
  const disconnectRealtime = useSpacesStore((state) => state.disconnectRealtime);
  const loading = useSpacesStore((state) => state.loading);
  const error = useSpacesStore((state) => state.error);
  const clearError = useSpacesStore((state) => state.clearError);
  const recordActivity = useExplorerStore((state) => state.recordActivity);
  const reportedErrorRef = useRef("");

  useEffect(() => {
    if (!user || transitioning) {
      disconnectRealtime();
      return;
    }
    void connectRealtime(user.id);
    void Promise.all([load(), loadInbox()]);
    return disconnectRealtime;
  }, [connectRealtime, disconnectRealtime, load, loadInbox, transitioning, user?.id]);

  useEffect(() => {
    if (!error) {
      reportedErrorRef.current = "";
      return;
    }
    if (isAccountSwitchError(error) || isReconnectError(error)) {
      clearError();
      return;
    }
    if (!user || transitioning || loading || reportedErrorRef.current === error) return;

    const timeout = window.setTimeout(() => {
      const current = useSpacesStore.getState();
      if (current.error !== error || current.loading) return;
      reportedErrorRef.current = error;
      recordActivity(spaceActivityMessage(error), "error");
    }, 1_200);
    return () => window.clearTimeout(timeout);
  }, [clearError, error, loading, recordActivity, transitioning, user]);

  return null;
}

function isAccountSwitchError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return normalized.includes("account switch") || normalized === "account_changed";
}

function isReconnectError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized === "load failed" ||
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror") ||
    normalized.includes("network request failed") ||
    normalized.includes("while misty reconnects")
  );
}

function spaceActivityMessage(message: string): string {
  return `Spaces needs attention: ${message.trim()}`;
}
