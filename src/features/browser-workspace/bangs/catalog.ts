import webTable from "@/shared/schemas/browser-bangs.json";
import { browserCustomBangs, browserSearchEngines } from "@/features/workspace/browserSearchEngine";
import type { Bang, ScopeBang, WebBang } from "./types";

const scope = (
  bang: Omit<ScopeBang, "kind" | "group" | "aliases"> & { aliases?: string[] },
): ScopeBang => ({ kind: "scope", group: "misty", aliases: [], ...bang });

/** Misty's own places. Fixed: custom shortcuts can never take these triggers. */
export const mistyBangs: readonly ScopeBang[] = [
  scope({
    trigger: "files",
    aliases: ["f"],
    scope: "files",
    label: "Files",
    description: "Search your files in Kura",
    placeholder: "Search your files in Kura",
  }),
  scope({
    trigger: "spaces",
    aliases: ["s"],
    scope: "spaces",
    label: "Spaces",
    description: "Everything in your spaces",
    placeholder: "Search your spaces",
  }),
  scope({
    trigger: "notes",
    aliases: ["n", "journal", "j"],
    scope: "notes",
    label: "Notes",
    description: "Journal notes in your spaces",
    placeholder: "Search your notes",
  }),
  scope({
    trigger: "tasks",
    aliases: ["task", "planner"],
    scope: "tasks",
    label: "Tasks",
    description: "Planner tasks in your spaces",
    placeholder: "Search your tasks",
  }),
  scope({
    trigger: "chat",
    aliases: ["c"],
    scope: "chat",
    label: "Chat",
    description: "Messages in space chats",
    placeholder: "Search chat messages",
  }),
  scope({
    trigger: "agents",
    aliases: ["a"],
    scope: "agents",
    label: "Agents",
    description: "Agents and past conversations",
    placeholder: "Search agents and conversations",
  }),
  scope({
    trigger: "bookmarks",
    aliases: ["b", "bm"],
    scope: "bookmarks",
    label: "Bookmarks",
    description: "Saved websites and folders",
    placeholder: "Search bookmarks",
  }),
  scope({
    trigger: "history",
    aliases: ["h"],
    scope: "history",
    label: "History",
    description: "Pages you visited and closed tabs",
    placeholder: "Search history",
  }),
  scope({
    trigger: "tabs",
    aliases: ["t"],
    scope: "tabs",
    label: "Tabs",
    description: "Open browser tabs in every window",
    placeholder: "Search open tabs",
  }),
  scope({
    trigger: "downloads",
    aliases: ["dl"],
    scope: "downloads",
    label: "Downloads",
    description: "Files downloaded from websites",
    placeholder: "Search downloads",
  }),
  scope({
    trigger: "settings",
    scope: "settings",
    label: "Settings",
    description: "Settings pages",
    placeholder: "Search settings",
  }),
  scope({
    trigger: "extensions",
    aliases: ["ext"],
    scope: "extensions",
    label: "Extensions",
    description: "Installed extensions",
    placeholder: "Search extensions",
  }),
];

const engineTriggers: Record<string, string[]> = {
  google: ["g", "google"],
  duckduckgo: ["ddg", "duckduckgo"],
  bing: ["bing"],
  brave: ["brave"],
  startpage: ["sp", "startpage"],
};

/** The search engines first, so `!g` and friends sit with the other sites. */
export const builtInWebBangs: readonly WebBang[] = [
  ...browserSearchEngines.map<WebBang>((engine) => {
    const [trigger, ...aliases] = engineTriggers[engine.id] ?? [engine.id];
    return {
      kind: "web",
      group: "web",
      trigger,
      aliases,
      label: engine.name,
      description: `Search ${engine.name}`,
      url: engine.search,
      home: `${new URL(engine.search).origin}/`,
    };
  }),
  ...webTable.map<WebBang>((entry) => ({
    kind: "web",
    group: "web",
    trigger: entry.trigger,
    aliases: entry.aliases,
    label: entry.name,
    description: `Search ${entry.name}`,
    url: entry.search,
    home: entry.home,
  })),
];

/** The trigger and its aliases, each typed after `!`. */
export function bangNames(bang: Bang): string[] {
  return [bang.trigger, ...bang.aliases];
}

/**
 * Every shortcut, in list order: Misty's places, then the person's own, then
 * the built-in sites. A custom shortcut replaces a built-in site with the same
 * name; one that collides with a Misty place is ignored.
 */
export function allBangs(): Bang[] {
  const reserved = new Set(mistyBangs.flatMap(bangNames));
  const custom = browserCustomBangs()
    .filter((entry) => !reserved.has(entry.trigger))
    .map<WebBang>((entry) => ({
      kind: "web",
      group: "custom",
      trigger: entry.trigger,
      aliases: [],
      label: entry.name,
      description: `Search ${entry.name}`,
      url: entry.url,
      home: customHome(entry.url),
    }));
  const taken = new Set(custom.map((bang) => bang.trigger));
  const web = builtInWebBangs
    .filter((bang) => !taken.has(bang.trigger))
    .map((bang) => ({ ...bang, aliases: bang.aliases.filter((alias) => !taken.has(alias)) }));
  return [...mistyBangs, ...custom, ...web];
}

function customHome(template: string): string {
  try {
    return `${new URL(template.replace("%s", "")).origin}/`;
  } catch {
    return "";
  }
}
