import { mistyBrowserProviders } from "@misty/sdk";
export type WebsiteAppId = "journal" | "planner" | "library";
export const websiteIntegrations = {
  "google-drive": { label: "Google Drive", category: "Cloud storage", description: "Open your files and shared drives." },
  dropbox: { label: "Dropbox", category: "Cloud storage", description: "Browse your Dropbox files and folders." },
  onedrive: { label: "OneDrive", category: "Cloud storage", description: "Open your personal and work files." },
  "google-docs": {
    label: "Google Docs",
    category: "Documents",
    description: "Write and collaborate in your Google documents.",
  },
  "microsoft-word": {
    label: "Microsoft Word",
    category: "Documents",
    description: "Open and edit your Word documents on the web.",
  },
  notion: {
    label: "Notion",
    category: "Notes & Wikis",
    description: "Your pages, team wikis, and Notion workspaces.",
  },
  "microsoft-onenote": {
    label: "Microsoft OneNote",
    category: "Notebooks",
    description: "Keep your OneNote notebooks close at hand.",
  },
  "google-calendar": {
    label: "Google Calendar",
    category: "Calendars",
    description: "Your Google calendars and upcoming events.",
  },
  "outlook-calendar": {
    label: "Outlook Calendar",
    category: "Calendars",
    description: "Plan your time in your Outlook calendars.",
  },
  "microsoft-todo": {
    label: "Microsoft To Do",
    category: "Tasks",
    description: "Your daily lists and Microsoft To Do tasks.",
  },
  todoist: {
    label: "Todoist",
    category: "Tasks",
    description: "Personal tasks and projects in Todoist.",
  },
  trello: {
    label: "Trello",
    category: "Projects & Boards",
    description: "Your Trello boards, cards, and team projects.",
  },
  asana: {
    label: "Asana",
    category: "Projects & Boards",
    description: "Follow your team's work and projects in Asana.",
  },
  jira: {
    label: "Jira Cloud",
    category: "Projects & Boards",
    description: "Your team's Jira issues, projects, and boards.",
  },
} as const;
export type WebsiteIntegrationId = keyof typeof websiteIntegrations;
export const websiteAppPath = (app: WebsiteAppId) => `/apps/${app}`;
export function integrationIds(app: WebsiteAppId) {
  return (Object.keys(websiteIntegrations) as WebsiteIntegrationId[]).filter(
    (id) => mistyBrowserProviders[id].owner === app,
  );
}
export function integrationFromRoute(
  route: string,
  app: WebsiteAppId,
): WebsiteIntegrationId | undefined {
  const id = new URL(route, "https://misty.local").searchParams.get("provider");
  return integrationIds(app).find((candidate) => candidate === id);
}
export function jiraWorkspace(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.atlassian\.net$/.test(url.hostname)
    )
      return;
    return `${url.origin}/jira/your-work`;
  } catch {
    return;
  }
}
/** Auth URLs are transient and never become a pin or a restored document. */
export function savedWebsiteUrl(
  id: keyof typeof mistyBrowserProviders,
  value: string,
): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      value.length > 8192
    )
      return;
    if (
      !mistyBrowserProviders[id].domains.some(
        (domain) =>
          url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      )
    )
      return;
    if (id === "jira" && !jiraWorkspace(value)) return;
    if (
      /(?:^|\/)(?:login|signin|sign-in|logout|signout|oauth2?|authorize|auth|callback|sso|checkpoint|challenge|onboarding|sign_in_with_password|workspace-signin)(?:\/|$|\.)/i.test(
        url.pathname,
      )
    )
      return;
    const params = [
      ...url.searchParams.keys(),
      ...new URLSearchParams(url.hash.slice(1)).keys(),
    ];
    if (
      params.some((key) =>
        /^(?:code|state|token|access_token|id_token|refresh_token|session_state|samlresponse|relaystate|ticket|authuser)$/i.test(
          key,
        ),
      )
    )
      return;
    return url.href;
  } catch {
    return;
  }
}
export function integrationRoute(
  app: WebsiteAppId,
  provider: WebsiteIntegrationId,
  account?: string,
  pin?: string,
) {
  const query = new URLSearchParams({ provider });
  if (account) query.set("account", account);
  if (pin) query.set("pin", pin);
  return `${websiteAppPath(app)}?${query}`;
}
