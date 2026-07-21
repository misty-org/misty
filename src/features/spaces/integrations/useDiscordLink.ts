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
  link: SpaceDiscordLink | null;
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
    link: null,
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
      spaceDiscordApi.link(spaceId),
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
      link: linkResult.status === "fulfilled" ? linkResult.value.link : null,
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

  const linkChannel = (channelId: string, conversationId: string) =>
    run("link", async () => {
      const channel = state.channels.find((item) => item.external_resource_id === channelId);
      if (!channel || !state.integration) throw new Error("Pick a Discord channel to link.");
      const configuration = channel.configuration as {
        guild_id?: string;
        guild_name?: string;
      };
      await spaceDiscordApi.createLink(spaceId, {
        integration_id: state.integration.id,
        conversation_id: conversationId,
        channel_id: channel.external_resource_id,
        channel_name: channel.display_name,
        guild_id: configuration.guild_id ?? "",
        guild_name: configuration.guild_name ?? "",
        direction: "two_way",
      });
      await load();
    });

  const setDirection = (direction: DiscordLinkDirection) =>
    run("direction", async () => {
      if (!state.link) return;
      const updated = await spaceDiscordApi.updateLink(spaceId, state.link.id, { direction });
      patch({ link: updated });
    });

  const sync = () =>
    run("sync", async () => {
      if (!state.link) return;
      const result = await spaceDiscordApi.sync(spaceId, state.link.id);
      patch({ link: result.link, error: result.error ?? "" });
    });

  const unlink = () =>
    run("unlink", async () => {
      if (!state.link) return;
      await spaceDiscordApi.deleteLink(spaceId, state.link.id);
      patch({ link: null });
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
