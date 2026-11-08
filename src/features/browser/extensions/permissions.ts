/** Human-readable review text; retain unknown permission names for honest disclosure. */
export function permissionLabel(permission: string): string {
  const labels: Record<string, string> = {
    storage: "Save extension settings",
    activeTab: "Access the current page when you use the extension",
    tabs: "Read browser tab titles and addresses",
    scripting: "Run extension scripts on permitted websites",
    nativeMessaging: "Connect to an installed companion application",
    cookies: "Access cookies on permitted websites",
    clipboardWrite: "Write to your clipboard",
    clipboardRead: "Read your clipboard",
    downloads: "Manage downloads",
    notifications: "Show notifications",
    contextMenus: "Add context-menu actions",
    menus: "Add context-menu actions",
    alarms: "Schedule extension tasks",
    idle: "Detect when you are away from your computer",
    history: "Read and delete your browsing history",
    topSites: "Read your most visited sites",
    bookmarks: "Read and change your bookmarks",
    sessions: "See and reopen recently closed tabs",
    search: "Search with your default search engine",
    browsingData: "Clear browsing history, downloads, cookies and site data",
    find: "Search text on the current page",
    tts: "Read text aloud",
    privacy: "Read privacy settings",
    management: "Read its own extension details",
    identity: "Sign in to websites through a sign-in tab",
    webRequestBlocking: "Block or change website requests (repeat requests only in Misty)",
    tabHide: "Hide tabs (not available in Misty)",
    contextualIdentities: "Use Firefox containers (not available in Misty)",
    theme: "Change the browser theme (not available in Misty)",
    webRequest: "Observe requests on permitted websites",
    webNavigation: "Observe navigation on permitted websites",
    declarativeNetRequest: "Block or modify website requests using extension rules",
    declarativeNetRequestWithHostAccess: "Block or modify requests on permitted websites",
    unlimitedStorage: "Store extension data without the usual local size limit",
    tabGroups: "See and change tab groups",
    declarativeContent: "React to the pages you visit",
    contentSettings: "Read site settings such as cookies and pop-ups",
    fontSettings: "Read font settings",
    power: "Ask to keep the computer awake (not available in Misty)",
    userScripts: "Run scripts you add on permitted websites",
    tabCapture: "Record a tab or window you choose",
    desktopCapture: "Record your screen or a window you choose",
    sidePanel: "Show a side panel (opens in a tab in Misty)",
    offscreen: "Run a hidden extension page in the background",
    pageCapture: "Save pages you visit",
    background: "Keep running in the background",
    geolocation: "See your location",
    gcm: "Receive messages from its developer's servers",
    favicon: "Read the icons of websites you visit",
    ttsEngine: "Read text aloud with its own voice",
    "system.cpu": "Read details about your computer",
    "system.memory": "Read details about your computer",
    "system.display": "Read details about your displays",
    "system.storage": "Read details about your computer's storage",
    debugger: "Inspect and control your pages (not available in Misty)",
    proxy: "Route your traffic through a server (not available in Misty)",
  };
  return labels[permission] ?? hostLabel(permission) ?? permission;
}

/** A host pattern in plain words, or null when `pattern` isn't one. */
function hostLabel(pattern: string): string | null {
  if (pattern === "<all_urls>") return allSites;
  const match = /^(\*|[a-z-]+):\/\/([^/]*)\/.*$/.exec(pattern);
  if (!match) return null;
  const [, scheme, host] = match;
  if (scheme === "file") return "Read files you open from this computer";
  if (host === "*") return allSites;
  if (host?.startsWith("*.")) return `Read and change data on ${host.slice(2)} and its subdomains`;
  return `Read and change data on ${host}`;
}

const allSites = "Read and change data on all websites";

/** Each distinct line to show for a list of access, with what it came from for the tooltip. */
export function accessLabels(access: string[]): { label: string; source: string }[] {
  const lines = new Map<string, string[]>();
  for (const item of access) {
    const label = permissionLabel(item);
    lines.set(label, [...(lines.get(label) ?? []), item]);
  }
  return [...lines].map(([label, sources]) => ({ label, source: sources.join(", ") }));
}
