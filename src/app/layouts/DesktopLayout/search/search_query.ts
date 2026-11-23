import type { SearchKind } from "./search_types";

export interface SearchQuery {
  text: string;
  kind?: SearchKind;
  ask?: { agentId: string; prompt: string };
}

export function readQuery(raw: string, agents: { id: string; name: string }[]): SearchQuery {
  const typed = raw.trimStart();
  const first = typed[0];
  if (first === ">" || first === "/") return { text: typed.slice(1).trim(), kind: "commands" };
  if (first === "#") return { text: typed.slice(1).trim(), kind: "space" };
  if (first === "@") {
    const rest = typed.slice(1);
    const lower = rest.toLocaleLowerCase();
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
  return { text: typed.trim() };
}
