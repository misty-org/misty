import { useEffect, useState } from "react";
import { CalendarDays, FileText, LoaderCircle, Plug, UserPlus, X } from "lucide-react";
import { SiDiscord } from "react-icons/si";
import { Link } from "react-router-dom";

import type {
  ProviderConnectionAvailability,
  SpaceIntegration,
  SpaceIntegrationProvider,
  SpaceSetup,
} from "@/models/interfaces/features/spaces/types";
import { openExternalLink } from "@/platform/openExternalLink";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import { Button, Card } from "@/ui";

export function SpaceSetupCards({
  spaceId,
  isOwner,
  showInvitation = false,
  dismissible = false,
}: {
  spaceId: string;
  isOwner: boolean;
  showInvitation?: boolean;
  dismissible?: boolean;
}) {
  const [setup, setSetup] = useState<SpaceSetup | null>(null);
  const [availability, setAvailability] = useState<ProviderConnectionAvailability[]>([]);
  const [integrations, setIntegrations] = useState<SpaceIntegration[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([spacesApi.setup(spaceId), spacesApi.integrations(spaceId)])
      .then(([nextSetup, integrations]) => {
        if (!active) return;
        setSetup(nextSetup);
        setAvailability(integrations.providers ?? []);
        setIntegrations(integrations.integrations);
      })
      .catch(() => {
        if (active) setSetup(null);
      });
    return () => {
      active = false;
    };
  }, [spaceId]);

  if (dismissed || (!showInvitation && !setup?.pending_providers.length)) return null;

  const connect = async (provider: SpaceIntegrationProvider) => {
    if (!isOwner || busy) return;
    setBusy(provider);
    setError("");
    try {
      const start = await spacesApi.beginProviderConnection(
        spaceId,
        provider,
        `/spaces/${spaceId}/settings/integrations`,
      );
      await openExternalLink(start.authorization_url);
    } catch {
      setError(`${providerName(provider)} could not start connecting. You can try again later.`);
    } finally {
      setBusy("");
    }
  };

  return (
    <Card className="mx-4 mt-3 grid gap-3 border-primary/20 bg-primary/[0.035] p-3 shadow-none">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-medium">Your Space is ready</p>
          <p className="mb-0 mt-1 text-xs text-muted-foreground">
            Start chatting now. Invitations and integrations can be finished whenever you want.
          </p>
        </div>
        {dismissible ? (
          <Button
            className="size-7 shrink-0"
            size="icon"
            variant="ghost"
            type="button"
            aria-label="Dismiss setup"
            onClick={() => setDismissed(true)}
          >
            <X size={14} />
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {showInvitation && isOwner ? (
          <Button asChild size="sm" variant="outline">
            <Link to={`/spaces/${encodeURIComponent(spaceId)}/members?invite=1`}>
              <UserPlus size={14} /> Invite people
            </Link>
          </Button>
        ) : null}
        {setup?.pending_providers.map((provider) => {
          const configured = availability.find((item) => item.provider === provider)?.configured;
          const connected = integrations.some(
            (integration) => integration.provider === provider && integration.status === "active",
          );
          const Icon = providerIcon(provider);
          if (connected)
            return (
              <Button asChild key={provider} size="sm" variant="outline">
                <Link to={providerManagementPath(spaceId, provider)}>
                  <Icon className="size-3.5" />
                  {providerManagementLabel(provider)}
                </Link>
              </Button>
            );
          return (
            <Button
              key={provider}
              size="sm"
              variant="outline"
              type="button"
              disabled={!isOwner || configured === false || Boolean(busy)}
              onClick={() => void connect(provider)}
              title={
                configured === false
                  ? `${providerName(provider)} is unavailable on this Misty server.`
                  : undefined
              }
            >
              {busy === provider ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Icon className="size-3.5" />
              )}
              {configured === false
                ? `${providerName(provider)} unavailable`
                : `Connect ${providerName(provider)}`}
            </Button>
          );
        })}
      </div>
      {error ? <p className="m-0 text-xs text-destructive">{error}</p> : null}
      {!isOwner && setup?.pending_providers.length ? (
        <p className="m-0 text-xs text-muted-foreground">
          The Space owner can finish these connections. They never limit your access.
        </p>
      ) : null}
    </Card>
  );
}

function providerName(provider: SpaceIntegrationProvider) {
  if (provider === "google") return "Google Calendar";
  if (provider === "discord") return "Discord";
  return "Notion";
}

function providerIcon(provider: SpaceIntegrationProvider) {
  if (provider === "google") return CalendarDays;
  if (provider === "discord") return SiDiscord;
  if (provider === "notion") return FileText;
  return Plug;
}

function providerManagementPath(spaceId: string, provider: SpaceIntegrationProvider) {
  const encoded = encodeURIComponent(spaceId);
  if (provider === "google") return `/spaces/${encoded}/tasks`;
  if (provider === "notion") return `/spaces/${encoded}/settings/integrations`;
  return `/spaces/${encoded}/settings/integrations`;
}

function providerManagementLabel(provider: SpaceIntegrationProvider) {
  if (provider === "google") return "Choose calendars";
  if (provider === "notion") return "Choose Notion sources";
  return "Choose Discord channels";
}
