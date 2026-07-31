import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { SiGooglecalendar } from "react-icons/si";
import { Link } from "react-router-dom";
import type {
  ProviderConnectionAvailability,
  SpaceIntegration,
} from "@/models/interfaces/features/spaces/types";
import { openExternalLink } from "@/platform/openExternalLink";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/ui";

export function GoogleCalendarConnectionPanel({
  spaceId,
  canManage,
}: {
  spaceId: string;
  canManage: boolean;
}) {
  const [connections, setConnections] = useState<SpaceIntegration[]>([]);
  const [availability, setAvailability] = useState<ProviderConnectionAvailability>();
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void spacesApi
      .integrations(spaceId)
      .then((result) => {
        if (!active) return;
        setConnections(
          result.integrations.filter(
            (connection) => connection.provider === "google" && connection.status === "active",
          ),
        );
        setAvailability(result.providers?.find((provider) => provider.provider === "google"));
      })
      .catch(() => {
        if (active) setError("Misty could not check Google Calendar connections.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [spaceId]);

  const connect = async () => {
    if (!canManage || connecting) return;
    setConnecting(true);
    setError("");
    try {
      const start = await spacesApi.beginProviderConnection(
        spaceId,
        "google",
        `/spaces/${spaceId}/settings/connections`,
      );
      await openExternalLink(start.authorization_url);
    } catch {
      setError("Google Calendar could not start connecting. Try again in a moment.");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Card size="sm" aria-labelledby="google-calendar-connection-heading">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="min-w-0">
          <CardTitle id="google-calendar-connection-heading" className="flex items-center gap-2">
            <SiGooglecalendar className="size-5 shrink-0" aria-hidden />
            <span className="truncate">Google Calendar</span>
          </CardTitle>
        </div>
        {loading ? (
          <LoaderCircle
            className="size-4 shrink-0 animate-spin text-muted-foreground"
            aria-label="Checking Google Calendar"
          />
        ) : availability?.configured === false ? (
          <Badge variant="outline">Unavailable</Badge>
        ) : connections.length ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge className="hidden lg:inline-flex" variant="secondary">
              Connected
            </Badge>
            <Button asChild size="sm" variant="outline">
              <Link to={`/spaces/${encodeURIComponent(spaceId)}/planner`}>Manage</Link>
            </Button>
          </div>
        ) : (
          <>
            {canManage ? (
              <Button size="sm" type="button" disabled={connecting} onClick={() => void connect()}>
                {connecting ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                Connect
              </Button>
            ) : (
              <Badge variant="outline">Not connected</Badge>
            )}
          </>
        )}
      </CardHeader>
      {error ? (
        <CardContent>
          <p className="m-0 text-xs text-destructive" role="alert">
            {error}
          </p>
        </CardContent>
      ) : null}
    </Card>
  );
}
