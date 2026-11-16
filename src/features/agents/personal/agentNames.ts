/**
 * The names a new agent gets when the person gives none. An agent is not its engine: "Codex" is
 * the CLI it runs on, shown by its own name and mark, while the agent is someone with a name of
 * its own. None of these is a product, a model or an engine (no Luna, Nova or Ada, which name
 * models), so an agent never reads as the thing under it.
 */
export const DEFAULT_AGENT_NAMES = [
  "Juno",
  "Milo",
  "Iris",
  "Otto",
  "Remy",
  "Wren",
  "Theo",
  "Mae",
  "Felix",
  "Hazel",
  "Ezra",
  "Pip",
  "Rosa",
  "Hugo",
  "Ivy",
  "Arlo",
] as const;

const key = (name: string) => name.trim().toLowerCase();

/**
 * The first default name none of `taken` already has, so no two of the person's agents share one.
 * Once all are taken, the first comes back with a number ("Juno 2").
 */
export function freshAgentName(taken: Iterable<string>): string {
  const used = new Set([...taken].map(key));
  const free = DEFAULT_AGENT_NAMES.find((name) => !used.has(key(name)));
  if (free) return free;
  for (let index = 2; ; index += 1) {
    const name = `${DEFAULT_AGENT_NAMES[0]} ${index}`;
    if (!used.has(key(name))) return name;
  }
}
