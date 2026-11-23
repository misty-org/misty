import { useEffect, useState } from "react";
import { accountApi, AccountApiError } from "../api/api";
import type { ServerAlert } from "../api/account_types";
import { useNotice } from "@misty/ui";
import { useAuth } from "../sessions/auth_state";

const refreshEvery = 5 * 60 * 1000;

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
  const problems = alerts.map((alert) => `${alert.title}. ${alert.detail}`).join(" ");
  useNotice(alerts.length > 0 && dismissed !== key, {
    message: `Your server needs a look. ${problems} Each clears here once the server checks it is fixed.`,
    onDismiss: () => setDismissed(key),
  });
  return null;
}
