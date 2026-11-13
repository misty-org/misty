import type { SearchKind } from "./searchTypes";

/** What a search box's text asks for, beyond the words to find. */
export interface SearchQuery {
  /** The words to search for, without any prefix. */
  text: string;
  /** A prefix that narrows the search: `>` or `/` commands, `#` the Space. */
  kind?: SearchKind;
  /** `@agent …`: the agent named, and what to ask it. */
  ask?: { agentId: string; prompt: string };
  /** `doc: …` (or `note: …`), `task: …` or `event: …` (with or without "new"): what to make. */
  create?: { what: "note" | "task" | "event"; title: string };
}

const createPattern = /^(?:new\s+)?(doc|note|task|event)\s*:\s*(\S.*)$/i;

/** Reads the prefixes out of what was typed. `agents` decides who `@` can name. */
export function readQuery(raw: string, agents: { id: string; name: string }[]): SearchQuery {
  const typed = raw.trimStart();
  const first = typed[0];
  if (first === ">" || first === "/") return { text: typed.slice(1).trim(), kind: "commands" };
  if (first === "#") return { text: typed.slice(1).trim(), kind: "space" };
  if (first === "@") {
    const rest = typed.slice(1);
    const lower = rest.toLocaleLowerCase();
    // The longest name the text starts with, so "Code reviewer" wins over "Code".
    const agent = [...agents]
      .sort((a, b) => b.name.length - a.name.length)
      .find((item) => {
        const name = item.name.toLocaleLowerCase();
        return (
          lower.startsWith(name) && (lower.length === name.length || /\s/.test(lower[name.length]))
        );
      });
    if (agent) {
      const prompt = rest.slice(agent.name.length).trim();
      return { text: prompt, ask: { agentId: agent.id, prompt } };
    }
    return { text: rest.trim(), kind: "chats" };
  }
  const create = createPattern.exec(typed);
  if (create)
    return {
      text: create[2].trim(),
      create: {
        what: (create[1].toLowerCase() === "doc" ? "note" : create[1].toLowerCase()) as
          "note" | "task" | "event",
        title: create[2].trim(),
      },
    };
  return { text: typed.trim() };
}
