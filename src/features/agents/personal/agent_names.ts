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

export function freshAgentName(taken: Iterable<string>): string {
  const used = new Set([...taken].map(key));
  const free = DEFAULT_AGENT_NAMES.find((name) => !used.has(key(name)));
  if (free) return free;
  for (let index = 2; ; index += 1) {
    const name = `${DEFAULT_AGENT_NAMES[0]} ${index}`;
    if (!used.has(key(name))) return name;
  }
}
