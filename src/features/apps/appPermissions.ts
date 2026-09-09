const permissionLabels: Record<string, string> = {
  "navigation.write": "Open tabs and add app shortcuts in Misty",
  "storage.read": "Read this app’s own settings and saved data",
  "storage.write": "Save this app’s own settings and data",
  "network.fetch": "Exchange data with this app’s connected web services",
  "browser.read": "View browser activity used by this app",
  "browser.write": "Create and manage browser workspaces",
  "search.write": "Manage searches and saved search data",
  "spaces.read": "View the active Space and its members",
  "messages.read": "Read conversations in the active Space",
  "messages.write": "Send, edit, and delete messages in the active Space",
  "notes.read": "Read notes in the active Space",
  "notes.write": "Create, edit, and delete notes in the active Space",
  "drawings.read": "View drawings in the active Space",
  "drawings.write": "Create, edit, and delete drawings in the active Space",
  "tasks.read": "View tasks in the active Space",
  "tasks.write": "Create, edit, and delete tasks in the active Space",
  "calendar.read": "View calendars in the active Space",
  "calendar.write": "Create, edit, and delete events and calendars in the active Space",
  "roadmaps.read": "View roadmaps in the active Space",
  "roadmaps.write": "Create, edit, and delete roadmaps in the active Space",
  "library.read": "View Library items in the active Space",
  "library.write": "Add, edit, and delete Library items in the active Space",
  "activity.read": "View recent activity in the active Space",
  "activity.write": "Mark or clear activity in the active Space",
  "agents.read": "View agents in the active Space",
  "agents.write": "Create and manage agents in the active Space",
  "files.read": "Read files and folders you choose",
  "files.open": "Open chosen files in their native applications",
  "files.write": "Create, change, rename, and delete files and folders you choose",
  "profile.read": "View your Misty profile",
  "connections.read": "View connected accounts used by this app",
  "connections.write": "Connect or disconnect accounts used by this app",
  "mail.read": "Read mail from accounts you connect",
  "mail.write": "Draft, send, and organize mail from accounts you connect",
  "ai.read": "View Misty conversations used by this app",
  "ai.write": "Ask Misty to create or update content in this app",
  "mcp.read": "View connected tools",
  "mcp.write": "Connect and manage tools",
  "automations.read": "View your automations",
  "automations.write": "Create and manage automations",
  "devices.read": "View devices linked to your account",
  "devices.write": "Manage linked devices",
  "media-search.read": "Search media available to Misty",
  "media-search.write": "Add media results to files you choose",
  "search.read": "Search your Misty content",
  "browser.navigate": "Open websites and manage browser views",
  "browser.inspect": "Read pages in this app’s browser views",
  "browser.interact": "Interact with pages in this app’s browser views",
  "code.execute": "Run development tools on this computer",
  "code.read": "Read files in projects you choose",
  "code.write": "Change files in projects you choose",
  "terminal.execute": "Run commands on this computer",
  "clipboard.read": "Read text from your clipboard with your permission",
  "clipboard.write": "Copy text to your clipboard with your permission",
  "links.open": "Open links in your default browser",
  "ai.use": "Share this app’s visible context with Misty when you use AI",
  "transfers.read": "View file transfer status",
  "transfers.write": "Retry or dismiss file transfers",
};

export function appPermissionLabel(scope: string): string {
  return permissionLabels[scope] ?? "This version of Misty cannot describe this access.";
}

export function hasUnknownAppPermissions(scopes: string[]): boolean {
  return scopes.some((scope) => !Object.prototype.hasOwnProperty.call(permissionLabels, scope));
}

const groupTitles: Record<string, string> = {
  spaces: "Your Space",
  messages: "Conversations",
  notes: "Notes",
  drawings: "Drawings",
  tasks: "Tasks",
  calendar: "Calendars",
  roadmaps: "Roadmaps",
  library: "Library",
  activity: "Activity",
  agents: "Agents",
  files: "Files and folders",
  profile: "Your profile",
  connections: "Connected accounts",
  mail: "Mail",
  ai: "Misty AI",
  mcp: "Connected tools",
  automations: "Automations",
  devices: "Your devices",
  "media-search": "Media search",
  search: "Search",
  browser: "Webpages",
  code: "Project files and tools",
  terminal: "Commands",
  clipboard: "Clipboard",
  links: "Links and tabs",
  navigation: "Links and tabs",
  storage: "App data",
  network: "Web services",
  transfers: "File transfers",
};

export function appPermissionGroups(scopes: string[], granted: string[] = []) {
  const groups = new Map<
    string,
    { title: string; scopes: string[]; descriptions: string[]; added: boolean }
  >();
  for (const scope of new Set(scopes)) {
    if (!Object.prototype.hasOwnProperty.call(permissionLabels, scope)) continue;
    const prefix = scope.split(".")[0];
    const title = groupTitles[prefix];
    const group = groups.get(title) ?? { title, scopes: [], descriptions: [], added: false };
    group.scopes.push(scope);
    group.descriptions.push(appPermissionLabel(scope));
    group.added ||= !granted.includes(scope);
    groups.set(title, group);
  }
  for (const group of groups.values()) {
    if (
      ["browser.navigate", "browser.inspect", "browser.interact"].every((scope) =>
        group.scopes.includes(scope),
      )
    ) {
      group.descriptions = [
        "Open, read, and interact with pages in this app’s browser views",
        ...group.scopes
          .filter(
            (scope) => !["browser.navigate", "browser.inspect", "browser.interact"].includes(scope),
          )
          .map(appPermissionLabel),
      ];
    }
    if (group.scopes.includes("storage.read") && group.scopes.includes("storage.write")) {
      group.descriptions = ["Read and save this app’s own settings and data"];
    }
  }
  return [...groups.values()];
}
