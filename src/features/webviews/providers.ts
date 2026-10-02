import { websiteIntegrations, type WebsiteIntegrationId } from "./websiteIntegrations";
import { mistyBrowserProviders, type MistyBrowserProvider } from "@/shared/schemas";
import { providerLoginUrls } from "./providerLoginUrls";
export type ProviderFamily = "chat" | "journal" | "planner" | "library" | "music" | "media";
export type ProviderId = MistyBrowserProvider["id"];
export const providers: Record<ProviderId, { label: string; url: string; family: ProviderFamily }> =
  {
    ...(Object.fromEntries(
      Object.entries(mistyBrowserProviders).map(([id, policy]) => [
        id,
        {
          label: websiteIntegrations[id as WebsiteIntegrationId]?.label ?? id,
          url: providerLoginUrls[id as ProviderId],
          family: policy.owner,
        },
      ]),
    ) as Record<ProviderId, { label: string; url: string; family: ProviderFamily }>),
    slack: {
      label: "Slack",
      url: providerLoginUrls.slack,
      family: "chat",
    },
    "microsoft-teams": {
      label: "Microsoft Teams",
      url: providerLoginUrls["microsoft-teams"],
      family: "chat",
    },
    instagram: {
      label: "Instagram",
      url: providerLoginUrls.instagram,
      family: "chat",
    },
    messenger: {
      label: "Messenger",
      url: providerLoginUrls.messenger,
      family: "chat",
    },
    x: { label: "X", url: providerLoginUrls.x, family: "chat" },
    discord: {
      label: "Discord",
      url: providerLoginUrls.discord,
      family: "chat",
    },
    reddit: {
      label: "Reddit",
      url: providerLoginUrls.reddit,
      family: "chat",
    },
    linkedin: {
      label: "LinkedIn",
      url: providerLoginUrls.linkedin,
      family: "chat",
    },
    "youtube-music": {
      label: "YouTube Music",
      url: providerLoginUrls["youtube-music"],
      family: "music",
    },
    spotify: {
      label: "Spotify",
      url: providerLoginUrls.spotify,
      family: "music",
    },
    "apple-music": {
      label: "Apple Music",
      url: providerLoginUrls["apple-music"],
      family: "music",
    },
    soundcloud: {
      label: "SoundCloud",
      url: providerLoginUrls.soundcloud,
      family: "music",
    },
    youtube: {
      label: "YouTube",
      url: providerLoginUrls.youtube,
      family: "media",
    },
    twitch: {
      label: "Twitch",
      url: providerLoginUrls.twitch,
      family: "media",
    },
    netflix: {
      label: "Netflix",
      url: providerLoginUrls.netflix,
      family: "media",
    },
    crunchyroll: {
      label: "Crunchyroll",
      url: providerLoginUrls.crunchyroll,
      family: "media",
    },
    "prime-video": {
      label: "Prime Video",
      url: providerLoginUrls["prime-video"],
      family: "media",
    },
  };
export function providerFromRoute(route: string, family: ProviderFamily): ProviderId | null {
  const url = new URL(route, "https://misty.local");
  const value = url.searchParams.get("provider") ?? "";
  return Object.prototype.hasOwnProperty.call(providers, value) &&
    providers[value as ProviderId].family === family
    ? (value as ProviderId)
    : null;
}
