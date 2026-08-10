import { FileText, LoaderCircle, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SiNotion } from "react-icons/si";

import { spacesApi } from "@/services/spaces/api";
import type {
  AvailableProviderResource,
  ProviderConnectionAvailability,
  ProviderSharedResource,
  SpaceIntegration,
} from "@/services/spaces/dto/interfaces/types";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox } from "@/shared/ui";

export function NotionConnectionPanel({
  spaceId,
  canManage,
}: {
  spaceId: string;
  canManage: boolean;
}) {
  const [integrations, setIntegrations] = useState<SpaceIntegration[]>([]);
  const [availability, setAvailability] = useState<ProviderConnectionAvailability>();
  const [shared, setShared] = useState<ProviderSharedResource[]>([]);
  const [available, setAvailable] = useState<Record<string, AvailableProviderResource[]>>({});
  const [desired, setDesired] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [integrationResult, resourceResult] = await Promise.all([
        spacesApi.integrations(spaceId),
        spacesApi.sharedProviderResources(spaceId),
      ]);
      const notionIntegrations = integrationResult.integrations.filter(
        (item) => item.provider === "notion" && item.status === "active",
      );
      const notionResources = resourceResult.resources.filter(
        (item) => item.provider === "notion" && item.status !== "disabled",
      );
      setIntegrations(notionIntegrations);
      setAvailability(integrationResult.providers?.find((item) => item.provider === "notion"));
      setShared(notionResources);
      setDesired(
        Object.fromEntries(
          notionIntegrations.map((integration) => [
            integration.id,
            new Set(
              notionResources
                .filter((resource) => resource.integration_id === integration.id)
                .map(resourceKey),
            ),
          ]),
        ),
      );
    } catch {
      setError("Misty could not check this Space’s Notion sources. Your other tools still work.");
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = async () => {
    if (!canManage || busy) return;
    setBusy("connect");
    setError("");
    try {
      const start = await spacesApi.beginProviderConnection(
        spaceId,
        "notion",
        `/spaces/${spaceId}/settings/connections`,
      );
      await openExternalLink(start.authorization_url);
    } catch {
      setError("Notion could not start connecting. You can try again later.");
    } finally {
      setBusy("");
    }
  };

  const discover = async (integrationId: string) => {
    if (!canManage || busy) return;
    setBusy(`discover:${integrationId}`);
    setError("");
    try {
      const result = await spacesApi.availableProviderResources(spaceId, integrationId);
      setAvailable((current) => ({ ...current, [integrationId]: result.resources }));
    } catch {
      setError("Misty could not list this account’s Notion pages and databases.");
    } finally {
      setBusy("");
    }
  };

  const save = async (integrationId: string) => {
    if (!canManage || busy) return;
    const choices = available[integrationId] ?? [];
    const selected = desired[integrationId] ?? new Set<string>();
    setBusy(`save:${integrationId}`);
    setError("");
    try {
      const result = await spacesApi.selectProviderResources(
        spaceId,
        integrationId,
        choices
          .filter((resource) => selected.has(resourceKey(resource)))
          .map(({ resource_type, external_resource_id }) => ({
            resource_type,
            external_resource_id,
          })),
      );
      setShared((current) => [
        ...current.filter((resource) => resource.integration_id !== integrationId),
        ...result.resources,
      ]);
    } catch {
      setError("Those Notion sources could not be saved. Your previous selection is unchanged.");
    } finally {
      setBusy("");
    }
  };

  const selectedCount = useMemo(
    () => shared.filter((resource) => resource.status !== "disabled").length,
    [shared],
  );

  return (
    <Card
      size="sm"
      className={expanded ? "sm:col-span-2 xl:col-span-3" : ""}
      aria-labelledby="notion-connection-heading"
    >
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="min-w-0">
          <CardTitle id="notion-connection-heading" className="flex items-center gap-2">
            <SiNotion className="size-5 shrink-0" aria-hidden />
            <span className="truncate">Notion</span>
          </CardTitle>
        </div>
        {loading ? (
          <LoaderCircle
            className="size-4 shrink-0 animate-spin text-cream-muted"
            aria-label="Checking Notion"
          />
        ) : availability?.configured === false ? (
          <Badge variant="outline">Unavailable</Badge>
        ) : !integrations.length ? (
          canManage ? (
            <Button size="sm" type="button" disabled={Boolean(busy)} onClick={() => void connect()}>
              {busy === "connect" ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : null}
              Connect
            </Button>
          ) : (
            <Badge variant="outline">Not connected</Badge>
          )
        ) : (
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge className="hidden lg:inline-flex" variant="secondary">
              {selectedCount ? `${selectedCount} selected` : "Connected"}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? "Done" : "Manage"}
            </Button>
          </div>
        )}
      </CardHeader>

      {error ? (
        <CardContent>
          <p className="m-0 text-xs text-cream-bright" role="alert">
            {error}
          </p>
        </CardContent>
      ) : null}

      {expanded && integrations.length ? (
        <CardContent className="grid gap-4 border-t border-charcoal-border/60 pt-4">
          {canManage
            ? integrations.map((integration) => (
                <NotionAccount
                  key={integration.id}
                  integration={integration}
                  resources={available[integration.id]}
                  selected={desired[integration.id] ?? new Set()}
                  busy={busy}
                  onLoad={() => void discover(integration.id)}
                  onToggle={(resource) =>
                    setDesired((current) => {
                      const next = new Set(current[integration.id] ?? []);
                      const key = resourceKey(resource);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return { ...current, [integration.id]: next };
                    })
                  }
                  onSave={() => void save(integration.id)}
                />
              ))
            : shared.map((resource) => <ResourceRow key={resource.id} resource={resource} />)}
          {canManage ? (
            <Button
              className="justify-self-start"
              size="sm"
              variant="outline"
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void connect()}
            >
              Add account
            </Button>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

function NotionAccount({
  integration,
  resources,
  selected,
  busy,
  onLoad,
  onToggle,
  onSave,
}: {
  integration: SpaceIntegration;
  resources?: AvailableProviderResource[];
  selected: Set<string>;
  busy: string;
  onLoad: () => void;
  onToggle: (resource: AvailableProviderResource) => void;
  onSave: () => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-charcoal-border/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="m-0 text-sm font-medium">{integration.display_name || "Notion account"}</p>
          <p className="mb-0 mt-0.5 text-xs text-cream-muted">
            {selected.size} source{selected.size === 1 ? "" : "s"} selected
          </p>
        </div>
        <Button
          aria-label={resources ? "Refresh Notion sources" : undefined}
          className={
            resources ? "size-8 text-cream-muted/70 shadow-none hover:text-cream" : undefined
          }
          variant={resources ? "ghost" : "outline"}
          size={resources ? "icon" : "sm"}
          title={resources ? "Refresh Notion sources" : undefined}
          type="button"
          disabled={Boolean(busy)}
          onClick={onLoad}
        >
          {busy === `discover:${integration.id}` ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCcw className="size-4" aria-hidden />
          )}
          {resources ? null : "Choose sources"}
        </Button>
      </div>
      {resources ? (
        resources.length ? (
          <>
            <div className="grid max-h-72 gap-1 overflow-auto">
              {resources.map((resource) => (
                <label
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-charcoal-card"
                  key={resourceKey(resource)}
                >
                  <Checkbox
                    checked={selected.has(resourceKey(resource))}
                    onCheckedChange={() => onToggle(resource)}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{resource.display_name}</span>
                  <Badge variant="outline">{resourceLabel(resource.resource_type)}</Badge>
                </label>
              ))}
            </div>
            <Button
              className="justify-self-start"
              type="button"
              disabled={Boolean(busy)}
              onClick={onSave}
            >
              {busy === `save:${integration.id}` ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : null}
              Save sources
            </Button>
          </>
        ) : (
          <p className="m-0 text-sm text-cream-muted">
            No pages or databases are available to this Notion connection.
          </p>
        )
      ) : null}
    </div>
  );
}

function ResourceRow({ resource }: { resource: ProviderSharedResource }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-charcoal-border/60 px-3 py-2">
      <FileText className="size-4 shrink-0 text-cream-muted" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm">{resource.display_name}</span>
      <Badge variant="outline">{resourceLabel(resource.resource_type)}</Badge>
    </div>
  );
}

function resourceKey(
  resource: Pick<AvailableProviderResource, "resource_type" | "external_resource_id">,
) {
  return `${resource.resource_type}\u0000${resource.external_resource_id}`;
}

function resourceLabel(type: AvailableProviderResource["resource_type"]) {
  if (type === "data_source") return "Data source";
  return type.charAt(0).toUpperCase() + type.slice(1);
}
