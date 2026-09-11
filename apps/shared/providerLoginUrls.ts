import { mistyBrowserProviders, type MistyBrowserProvider } from "@misty/sdk";

type ProviderId = MistyBrowserProvider["id"];
const googleLogin = (destination: string) =>
  `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(destination)}`;

/** Stable sign-in entry points, never captured OAuth URLs with state or PKCE.
 * Keep product destinations in the SDK navigation policy; these are app launch defaults.
 * Existing cookies let providers resume signed-in sessions themselves.
 */
export const providerLoginUrls: Record<ProviderId, string> = {
  "google-drive": googleLogin(mistyBrowserProviders["google-drive"].url),
  dropbox: "https://www.dropbox.com/login",
  onedrive: "https://onedrive.live.com/login/",
  google: googleLogin(mistyBrowserProviders.google.url),
  microsoft: "https://outlook.live.com/owa/?nlp=1",
  instagram:
    "https://www.instagram.com/accounts/login/?next=%2Fdirect%2Finbox%2F",
  messenger: "https://www.messenger.com/login/",
  x: "https://x.com/i/flow/login",
  discord: "https://discord.com/login",
  slack: "https://slack.com/signin#/signin",
  // These product applications own their sign-in flow; their identity-provider
  // URLs require per-session state and cannot be used as static launch URLs.
  "microsoft-teams": "https://teams.microsoft.com/",
  icloud: "https://www.icloud.com/mail/",
  yahoo:
    "https://login.yahoo.com/?src=ym&.done=https%3A%2F%2Fmail.yahoo.com%2F",
  "google-docs": googleLogin(mistyBrowserProviders["google-docs"].url),
  "microsoft-word": "https://www.office.com/login?ru=%2Flaunch%2Fword",
  notion: "https://www.notion.so/login",
  "microsoft-onenote": "https://www.office.com/login?ru=%2Flaunch%2Fonenote",
  "google-calendar": googleLogin(mistyBrowserProviders["google-calendar"].url),
  "outlook-calendar": "https://outlook.live.com/calendar/?nlp=1",
  "microsoft-todo": "https://to-do.live.com/tasks/",
  todoist: "https://app.todoist.com/auth/login",
  trello: "https://trello.com/login",
  asana: "https://app.asana.com/-/login",
  jira: "https://id.atlassian.com/login?application=jira",
};

/** Upgrade a former default without replacing a user's document or workspace URL. */
export function providerLaunchUrl(
  provider: ProviderId,
  saved?: string,
): string {
  return !saved || saved === mistyBrowserProviders[provider].url
    ? providerLoginUrls[provider]
    : saved;
}
