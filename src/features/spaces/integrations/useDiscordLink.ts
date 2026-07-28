import { useCallback, useEffect, useState } from "react";

import { errorText } from "@/lib/format";
import { openExternalLink } from "@/platform/openExternalLink";
import { spaceDiscordApi } from "@/stores/spaces/useSpaceDiscordStore";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { SpaceDiscordLink } from "@/models/interfaces/features/spaces/integrations/discord";
import type { SpaceConversation } from "@/models/interfaces/features/spaces/conversationTypes";
import type {
  AvailableProviderResource,
  SpaceIntegration,
} from "@/models/interfaces/features/spaces/agentArchitectureTypes";
import type { DiscordLinkDirection } from "@/models/types/features/spaces/integrations/discord";

export interface DiscordLinkState {
  integration?: SpaceIntegration;
  /** Undefined means the provider catalog could not be checked. */
  providerConfigured?: boolean;
  providerDiscoveryError: string;
  links: SpaceDiscordLink[];
  channels: AvailableProviderResource[];
  channelDiscoveryError: string;
  conversations: SpaceConversation[];
  conversationDiscoveryError: string;
  loading: boolean;
  busy: string;
  error: string;
}

/**
 * Owns the Space ↔ Discord link lifecycle for the settings panel.
 *
 * Channel discovery is deliberately lazy: listing a guild's channels is a real
 * Discord call, so it only happens once an integration exists and the panel is
 * actually open.
 */
export function useDiscordLink(spaceId: string, canManage: boolean) {
  const [state, setState] = useState<DiscordLinkState>({
    providerConfigured: undefined,
    providerDiscoveryError: "",
    links: [],
    channels: [],
    channelDiscoveryError: "",
    conversations: [],
    conversationDiscoveryError: "",
    loading: true,
    busy: "",
    error: "",
  });

  const patch = useCallback(
    (next: Partial<DiscordLinkState>) => setState((current) => ({ ...current, ...next })),
    [],
  );

  const load = useCallback(async () => {
    patch({ loading: true, error: "" });
    const [integrationResult, linkResult, conversationResult] = await Promise.allSettled([
      spacesApi.integrations(spaceId),
      spaceDiscordApi.links(spaceId),
      spacesApi.conversations(spaceId),
    ]);
    const integration =
      integrationResult.status === "fulfilled"
        ? integrationResult.value.integrations.find((item) => item.provider === "discord")
        : undefined;
    const providerConfigured =
      integrationResult.status === "fulfilled"
        ? (integrationResult.value.providers?.some(
            (provider) => provider.provider === "discord" && provider.configured,
          ) ?? false)
        : undefined;
    let channels: AvailableProviderResource[] = [];
    let channelDiscoveryError = "";
    if (integration) {
      try {
        channels = await listChannels(spaceId, integration.id);
      } catch (reason) {
        channelDiscoveryError = errorText(reason);
      }
    }
    patch({
      integration,
      providerConfigured,
      providerDiscoveryError:
        integrationResult.status === "rejected"
          ? "Misty could not check whether Discord is available."
          : "",
      links: linkResult.status === "fulfilled" ? linkResult.value.links : [],
      channels,
      channelDiscoveryError,
      conversations:
        conversationResult.status === "fulfilled" ? conversationResult.value.conversations : [],
      conversationDiscoveryError:
        conversationResult.status === "rejected"
          ? "Space conversations could not be loaded. Check your Chat access or try again."
          : "",
      error:
        linkResult.status === "rejected" ? "Misty could not check the current Discord link." : "",
      loading: false,
    });
  }, [patch, spaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one guarded action, keeping a single busy key and error surface. */
  const run = useCallback(
    async (key: string, action: () => Promise<void>) => {
      if (!canManage) return;
      patch({ busy: key, error: "" });
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
        "discord",
        `/spaces/${spaceId}/settings/integrations`,
      );
      await openExternalLink(start.authorization_url);
    });

  const linkChannel = (channelId: string) =>
    run(`link:${channelId}`, async () => {
      const channel = state.channels.find((item) => item.external_resource_id === channelId);
      if (!channel || !state.integration) throw new Error("Pick a Discord channel to link.");
      const configuration = channel.configuration as {
        guild_id?: string;
        guild_name?: string;
      };
      await spaceDiscordApi.createLink(spaceId, {
        integration_id: state.integration.id,
        conversation_id: "",
        channel_id: channel.external_resource_id,
        channel_name: channel.display_name,
        guild_id: configuration.guild_id ?? "",
        guild_name: configuration.guild_name ?? "",
        direction: "two_way",
      });
      await load();
    });

  const setDirection = (linkId: string, direction: DiscordLinkDirection) =>
    run(`direction:${linkId}`, async () => {
      const updated = await spaceDiscordApi.updateLink(spaceId, linkId, { direction });
      patch({ links: state.links.map((link) => (link.id === linkId ? updated : link)) });
    });

  const sync = (linkId: string) =>
    run(`sync:${linkId}`, async () => {
      const result = await spaceDiscordApi.sync(spaceId, linkId);
      patch({
        links: state.links.map((link) => (link.id === linkId ? result.link : link)),
        error: result.error ?? "",
      });
    });

  const unlink = (linkId: string) =>
    run(`unlink:${linkId}`, async () => {
      await spaceDiscordApi.deleteLink(spaceId, linkId);
      patch({ links: state.links.filter((link) => link.id !== linkId) });
    });

  return { ...state, reload: load, connect, linkChannel, setDirection, sync, unlink };
}

/**
 * Channel discovery stays separate from connection discovery so the settings
 * panel can distinguish a genuinely empty server from a failed Discord call.
 */
async function listChannels(spaceId: string, integrationId: string) {
  const result = await spacesApi.availableProviderResources(spaceId, integrationId);
  return result.resources.filter(
    (resource) => resource.provider === "discord" && resource.resource_type === "channel",
  );
}
