const configuredDiscordInvite = import.meta.env.VITE_DISCORD_INVITE_URL?.trim();

export const BETA_ACCESS_HREF =
  configuredDiscordInvite && /^https:\/\//i.test(configuredDiscordInvite)
    ? configuredDiscordInvite
    : "/waitlist";

export const BETA_ACCESS_IS_EXTERNAL = BETA_ACCESS_HREF !== "/waitlist";
export const BETA_ACCESS_EXTERNAL = BETA_ACCESS_IS_EXTERNAL;
export const SITE_URL = "https://mistysys.com";
export const PUBLIC_RELEASES_URL = "https://github.com/misty-org/misty-public/releases";
