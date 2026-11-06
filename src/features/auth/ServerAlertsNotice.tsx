import { useEffect, useState } from "react";
import { accountApi, AccountApiError } from "@/api/account/api";
import type { ServerAlert } from "@/api/account/types";
import { Notification } from "@/shared/ui";
import { useAuth } from "./authState";

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
  if (!alerts.length || dismissed === key) return null;
  return (
    <Notification title="Your server needs a look" onDismiss={() => setDismissed(key)}>
      <ul className="m-0 grid list-none gap-1 p-0">
        {alerts.map((alert) => (
          <li key={alert.probe}>
            <span className="text-cream">{alert.title}.</span> {alert.detail}
          </li>
        ))}
      </ul>
      <p className="m-0 mt-1">Each clears here once the server checks it is fixed.</p>
    </Notification>
  );
}
