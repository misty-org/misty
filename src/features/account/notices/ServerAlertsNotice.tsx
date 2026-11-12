import { useEffect, useState } from "react";
import { accountApi, AccountApiError } from "../api/api";
import type { ServerAlert } from "../api/accountTypes";
import { useNotice } from "@/shared/ui";
import { useAuth } from "../sessions/authState";

const refreshEvery = 5 * 60 * 1000;

/**
 * The server's owner (its first account) sees the alerts service's open problems here: this and
 * the operator console are where they show. The notice is
 * calm and neutral, lists each problem, and leaves when they clear. Anyone else gets 403 once
 * and nothing more is asked. Dismissing hides it until the set of problems changes.
 */
export function ServerAlertsNotice() {
  const { user } = useAuth();
  const userId = user?.id;
  const [alerts, setAlerts] = useState<ServerAlert[]>([]);
  const [dismissed, setDismissed] = useState("");

  useEffect(() => {
    setAlerts([]);
    if (!userId) return;
    let active = true;
    let timer = 0;
    const load = () => {
      void accountApi
        .serverAlerts()
        .then((answer) => {
          if (!active) return;
          setAlerts(answer.alerts ?? []);
          timer = window.setTimeout(load, refreshEvery);
        })
        .catch((error: unknown) => {
          if (!active) return;
          // Not the owner, or a server from before alerts: stop asking.
          if (error instanceof AccountApiError && (error.status === 403 || error.status === 404))
            return;
          timer = window.setTimeout(load, refreshEvery);
        });
    };
    load();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [userId]);

  const key = alerts.map((alert) => `${alert.probe}:${alert.opened_at}`).join("|");
  // A notice is one message: the title, each problem in turn, then how it clears.
  const problems = alerts.map((alert) => `${alert.title}. ${alert.detail}`).join(" ");
  useNotice(alerts.length > 0 && dismissed !== key, {
    message: `Your server needs a look. ${problems} Each clears here once the server checks it is fixed.`,
    onDismiss: () => setDismissed(key),
  });
  return null;
}
