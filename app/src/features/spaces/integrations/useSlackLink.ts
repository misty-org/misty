import { spaceSlackApi } from "@/api/integrations/slack";
import { spacesApi } from "@/api/spaces/api";
import type {
  AvailableProviderResource,
  SpaceIntegration,
} from "@/api/spaces/dto/interfaces/agentArchitectureTypes";
import type { SpaceConversation } from "@/api/spaces/dto/interfaces/types";
import type { SpaceSlackLink } from "@/api/spaces/dto/interfaces/connections/slack";
import type { SlackLinkDirection } from "@/api/spaces/dto/interfaces/connections/slack";
import { errorText } from "@/shared/lib/format";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { useCallback, useEffect, useState } from "react";

interface SlackLinkState {
  integration?: SpaceIntegration;
  providerConfigured?: boolean;
  providerDiscoveryError: string;
  links: SpaceSlackLink[];
  channels: AvailableProviderResource[];
  channelDiscoveryError: string;
  conversations: SpaceConversation[];
  loading: boolean;
  busy: string;
  error: string;
  syncFeedback: string;
}

export function useSlackLink(spaceId: string, canManage: boolean) {
  const [state, setState] = useState<SlackLinkState>({
    providerConfigured: undefined,
    providerDiscoveryError: "",
    links: [],
    channels: [],
    channelDiscoveryError: "",
    conversations: [],
    loading: true,
    busy: "",
    error: "",
    syncFeedback: "",
  });
  const patch = useCallback(
    (next: Partial<SlackLinkState>) => setState((current) => ({ ...current, ...next })),
    [],
  );

  const load = useCallback(async () => {
    patch({ loading: true, error: "" });
    const [integrationResult, linkResult, conversationResult] = await Promise.allSettled([
      spacesApi.integrations(spaceId),
      spaceSlackApi.links(spaceId),
      spacesApi.conversations(spaceId),
    ]);
    const integration =
      integrationResult.status === "fulfilled"
        ? integrationResult.value.integrations.find((item) => item.provider === "slack")
        : undefined;
    const providerConfigured =
      integrationResult.status === "fulfilled"
        ? (integrationResult.value.providers?.some(
            (provider) => provider.provider === "slack" && provider.configured,
          ) ?? false)
        : undefined;
    let channels: AvailableProviderResource[] = [];
    let channelDiscoveryError = "";
    if (integration) {
      try {
        const result = await spacesApi.availableProviderResources(spaceId, integration.id);
        channels = result.resources.filter(
          (resource) => resource.provider === "slack" && resource.resource_type === "channel",
        );
      } catch (reason) {
        channelDiscoveryError = errorText(reason);
      }
    }
    patch({
      integration,
      providerConfigured,
      providerDiscoveryError:
        integrationResult.status === "rejected"
          ? "Misty could not check whether Slack is available."
          : "",
      links: linkResult.status === "fulfilled" ? linkResult.value.links : [],
      channels,
      channelDiscoveryError,
      conversations:
        conversationResult.status === "fulfilled" ? conversationResult.value.conversations : [],
      error: linkResult.status === "rejected" ? "Misty could not check Slack channel links." : "",
      loading: false,
    });
  }, [patch, spaceId]);

  useEffect(() => void load(), [load]);

  const run = useCallback(
    async (key: string, action: () => Promise<void>) => {
      if (!canManage) return;
      patch({ busy: key, error: "", syncFeedback: "" });
      try {
        await action();
      } catch (reason) {
        patch({ error: errorText(reason) });
      } finally {
        patch({ busy: "" });
      }
    },
    [canManage, patch],
  );

  const connect = () =>
    run("connect", async () => {
      const start = await spacesApi.beginProviderConnection(
        spaceId,
        "slack",
        `/spaces/${spaceId}/chat`,
      );
      await openExternalLink(start.authorization_url);
    });
  const disconnect = () =>
    run("disconnect", async () => {
      if (!state.integration) return;
      await spacesApi.deleteProviderIntegration(state.integration.id);
      await load();
    });
  const linkChannel = (channelId: string) =>
    run(`link:${channelId}`, async () => {
      if (
        !state.integration ||
        !state.channels.some((item) => item.external_resource_id === channelId)
      )
        throw new Error("Pick a Slack channel to link.");
      const result = await spaceSlackApi.createLink(spaceId, {
        integration_id: state.integration.id,
        channel_id: channelId,
        direction: "two_way",
      });
      patch({ syncFeedback: syncMessage(result.imported) });
      await load();
    });
  const setDirection = (linkId: string, direction: SlackLinkDirection) =>
    run(`direction:${linkId}`, async () => {
      const result = await spaceSlackApi.updateLink(spaceId, linkId, direction);
      patch({ links: state.links.map((link) => (link.id === linkId ? result.link : link)) });
    });
  const sync = (linkId: string) =>
    run(`sync:${linkId}`, async () => {
      const result = await spaceSlackApi.sync(spaceId, linkId);
      patch({
        links: state.links.map((link) => (link.id === linkId ? result.link : link)),
        syncFeedback: syncMessage(result.imported),
      });
    });
  const unlink = (linkId: string) =>
    run(`unlink:${linkId}`, async () => {
      await spaceSlackApi.deleteLink(spaceId, linkId);
      patch({ links: state.links.filter((link) => link.id !== linkId) });
    });

  return { ...state, reload: load, connect, disconnect, linkChannel, setDirection, sync, unlink };
}

function syncMessage(imported: number) {
  return imported === 1 ? "Imported 1 Slack message." : `Imported ${imported} Slack messages.`;
}
