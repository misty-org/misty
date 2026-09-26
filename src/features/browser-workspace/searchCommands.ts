export type SearchScope = "browser" | "files" | "spaces" | "agents";

export interface SearchCommand {
  scope: SearchScope;
  command: string;
  label: string;
  description: string;
  placeholder: string;
}

export const searchCommands: SearchCommand[] = [
  {
    scope: "browser",
    command: "/browser",
    label: "Browser",
    description: "Open a website or search Google",
    placeholder: "Search Google or enter a URL",
  },
  {
    scope: "files",
    command: "/files",
    label: "Files",
    description: "Search file names and contents",
    placeholder: "Search your files",
  },
  {
    scope: "spaces",
    command: "/spaces",
    label: "Spaces",
    description: "Search your spaces and their libraries",
    placeholder: "Search your spaces",
  },
  {
    scope: "agents",
    command: "/agents",
    label: "Agents",
    description: "Find an agent or past conversation",
    placeholder: "Search agents and conversations",
  },
];

export function searchCommandFor(scope: SearchScope): SearchCommand {
  return searchCommands.find((command) => command.scope === scope)!;
}

/** `/files report` switches scope once the command is followed by a space.
 * Anything else — including paths like `/usr/bin` — stays a plain query. */
export function parseSearchCommand(input: string): { scope: SearchScope; query: string } | null {
  const match = /^\/(\w+)\s(.*)$/s.exec(input.trimStart());
  if (!match) return null;
  const command = searchCommands.find((entry) => entry.command === `/${match[1].toLowerCase()}`);
  return command ? { scope: command.scope, query: match[2] } : null;
}

/** Commands to suggest while the user is still typing a bare `/word`. */
export function matchingSearchCommands(input: string): SearchCommand[] {
  const match = /^\/(\w*)$/.exec(input.trim());
  if (!match) return [];
  const prefix = match[1].toLowerCase();
  return searchCommands.filter((entry) => entry.command.slice(1).startsWith(prefix));
}
