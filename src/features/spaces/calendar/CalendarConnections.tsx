import { appsApi, type ConnectedApp } from "@/features/agents/connectedAppsPublic";
import { modelKeysChangedEvent, openModelSettings } from "@/features/agents/modelKeysPublic";
import { confirmAction } from "@/shared/lib/confirmAction";
import { errorText } from "@/shared/lib/format";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { Button, Popover, PopoverContent, PopoverTrigger, Skeleton } from "@/shared/ui";
import { Link2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * The calendars a person can connect. Each is a Composio app, connected on this computer with the
 * person's own Composio key like every other connected app: the account and its events never reach
 * a Misty server. Notion Calendar has no connection of its own; it shows a Google Calendar account
 * and Notion's dated pages, which are these two.
 */
export const calendarApps = [
  { app: "googlecalendar", name: "Google Calendar" },
  { app: "notion", name: "Notion" },
] as const;

/** The account a calendar app is connected as, when it is. */
export function connectedCalendar(
  apps: ConnectedApp[] | undefined,
  app: string,
): ConnectedApp | undefined {
  return apps?.find((item) => item.app === app && item.status === "active");
}

/** Connects and disconnects the person's calendars. */
export function CalendarConnections({ onChange }: { onChange?(): void }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ available: boolean; apps: ConnectedApp[] }>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setState(await appsApi.list());
      setError("");
      // A calendar connected or disconnected a moment ago changes what the grid shows.
      onChange?.();
    } catch (reason) {
      setState((known) => known ?? { available: true, apps: [] });
      setError(errorText(reason));
    }
  }, [onChange]);

  // A sign-in finishes in the browser, and a key is saved in Settings: look again on return.
  useEffect(() => {
    if (!open) return;
    void refresh();
    const check = () => void refresh();
    window.addEventListener("focus", check);
    window.addEventListener(modelKeysChangedEvent, check);
    return () => {
      window.removeEventListener("focus", check);
      window.removeEventListener(modelKeysChangedEvent, check);
    };
  }, [open, refresh]);

  const act = async (app: string, work: () => Promise<void>) => {
    setBusy(app);
    setError("");
    try {
      await work();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="ghost">
          <Link2 aria-hidden="true" />
          Connect calendars
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-80 gap-3">
        {!state ? (
          calendarApps.map((item) => <Skeleton key={item.app} className="h-8" />)
        ) : !state.available ? (
          <div className="grid justify-items-start gap-2 text-sm text-cream">
            <p className="m-0">Add a Composio key to connect a calendar.</p>
            <Button type="button" size="sm" variant="outline" onClick={openModelSettings}>
              Open Models
            </Button>
          </div>
        ) : (
          calendarApps.map((item) => {
            const account = connectedCalendar(state.apps, item.app);
            return (
              <div key={item.app} className="flex min-h-8 items-center gap-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-cream">{item.name}</span>
                  {account?.account ? (
                    <span className="block truncate text-xs text-cream-muted">
                      {account.account}
                    </span>
                  ) : null}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy === item.app}
                  onClick={() =>
                    void act(item.app, async () => {
                      if (!account) {
                        await openExternalLink((await appsApi.connect(item.app)).url);
                        return;
                      }
                      const sure = await confirmAction(
                        `Disconnect ${item.name}? Agents lose access right away.`,
                        "Disconnect app",
                      );
                      if (!sure) return;
                      await appsApi.disconnect(account.id);
                      await refresh();
                    })
                  }
                >
                  {account ? "Disconnect" : "Connect"}
                </Button>
              </div>
            );
          })
        )}
        {error ? (
          <p role="alert" className="m-0 text-xs text-cream-bright">
            {error}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
