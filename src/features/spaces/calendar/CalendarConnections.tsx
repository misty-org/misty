import {
  appsApi,
  useConnectedApps,
  type ConnectedApp,
} from "@/features/agents/connectedAppsPublic";
import { modelKeysChangedEvent, openModelSettings } from "@/features/agents/modelKeysPublic";
import { confirmAction } from "@/shared/lib/confirmAction";
import { errorText } from "@/shared/lib/format";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  Button,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Skeleton,
  Text,
} from "@/shared/ui";
import { Link2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * The calendars a person can connect. Each is a Composio app, connected on this computer with the
 * person's own Composio key like every other connected app: the account and its events never reach
 * a Misty server. Notion Calendar has no connection of its own; it shows a Google Calendar account
 * and Notion's dated pages, which are these two.
 */
const calendarApps = [
  { app: "googlecalendar", name: "Google Calendar" },
  { app: "notion", name: "Notion" },
] as const;

/** With nothing saved and the list refused, the popover shows both calendars to connect. */
const noApps = { available: true, apps: [] as ConnectedApp[] };

/** The account a calendar app is connected as, when it is. */
function connectedCalendar(
  apps: ConnectedApp[] | undefined,
  app: string,
): ConnectedApp | undefined {
  return apps?.find((item) => item.app === app && item.status === "active");
}

/** Connects and disconnects the person's calendars. */
export function CalendarConnections({ onChange }: { onChange?(): void }) {
  const [open, setOpen] = useState(false);
  // The connected apps paint from their saved copy at once and refresh behind it.
  const listing = useConnectedApps();
  const state = listing.data ?? (listing.error ? noApps : undefined);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const { reload } = listing;

  const refresh = useCallback(async () => {
    try {
      await reload({ force: true });
      setError("");
      // A calendar connected or disconnected a moment ago changes what the grid shows.
      onChange?.();
    } catch (reason) {
      setError(errorText(reason));
    }
  }, [onChange, reload]);
  const shownError = error || (listing.error ? errorText(listing.error) : "");

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
        <Button type="button" variant="quiet" icon={Link2}>
          Connect calendars
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" size="lg">
        <PopoverHeader title="Calendars" />
        <PopoverBody>
          {!state ? (
            calendarApps.map((item) => (
              <div key={item.app} className="flex min-h-8 items-center gap-3" aria-hidden="true">
                <Skeleton className="h-3.5 max-w-32 flex-1" />
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
            ))
          ) : !state.available ? (
            <Text bare as="div" tone="default" className="grid justify-items-start gap-2 text-sm">
              <p className="m-0">Add a Composio key to connect a calendar.</p>
              <Button type="button" variant="secondary" onClick={openModelSettings}>
                Open Models
              </Button>
            </Text>
          ) : (
            calendarApps.map((item) => {
              const account = connectedCalendar(state.apps, item.app);
              return (
                <div key={item.app} className="flex min-h-8 items-center gap-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <Text full tone="default">
                      {item.name}
                    </Text>
                    {account?.account ? (
                      <Text full tone="muted" className="text-xs">
                        {account.account}
                      </Text>
                    ) : null}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
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
          {shownError ? (
            <Text wrap role="alert" tone="bright" className="m-0 text-xs">
              {shownError}
            </Text>
          ) : null}
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}
