import { useEffect, useState } from "react";
import { PlatformDirectory } from "./PlatformDirectory";
import type { MistyAppSDK } from "@misty/sdk";
import {
  integrationIds,
  integrationRoute,
  websiteIntegrations,
  type WebsiteAppId,
  type WebsiteIntegrationId,
} from "./websiteIntegrations";
import { addWebsiteService, removeWebsiteService } from "./websiteStore";
import { useWebsiteState } from "./useWebsiteState";
import { WebsiteBrandIcon } from "./WebsiteBrandIcon";
export function WebsiteDirectory({
  appId,
  misty,
  embedded = false,
}: {
  appId: WebsiteAppId;
  misty: MistyAppSDK;
  embedded?: boolean;
}) {
  const { state, error: loadError, retry } = useWebsiteState(misty, appId);
  const [busy, setBusy] = useState<string>(),
    [error, setError] = useState("");
  const ids = integrationIds(appId);
  useEffect(() => {
    if (embedded) return;
    void misty.workspace
      .setTitle(
        `${appId === "journal" ? "Journal" : appId === "library" ? "Library" : "Planner"}`,
      )
      .catch(() => {});
  }, [misty, appId, embedded]);
  const run = (id: string, action: () => Promise<unknown>) => {
    setBusy(id);
    setError("");
    void action()
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "The website could not be changed. Try again.",
        ),
      )
      .finally(() => setBusy(undefined));
  };
  const open = async (id: WebsiteIntegrationId) => {
    await addWebsiteService(misty.storage.local, id);
    await misty.navigation.open(`${integrationRoute(appId, id)}`);
  };
  return (
    <PlatformDirectory
      title={
        appId === "journal"
          ? "Journal"
          : appId === "library"
            ? "Library"
            : "Planner"
      }
      embedded={embedded}
      loading={!state}
      error={loadError || error}
      onRetry={retry}
      busy={busy}
      entries={
        state
          ? ids.map((id) => {
              const item = websiteIntegrations[id],
                service = state.services.find((s) => s.id === id);
              return {
                id,
                label: item.label,
                icon: <WebsiteBrandIcon id={id} />,
                added: !!service,
                description: service?.removing
                  ? "Removal needs attention"
                  : service
                    ? "In your sidebar"
                    : item.description,
                onSelect: () => run(id, () => open(id)),
                onOpen: () =>
                  run(id, () =>
                    service?.removing
                      ? removeWebsiteService(misty, service, state.accounts)
                      : open(id),
                  ),
              };
            })
          : []
      }
    />
  );
}
