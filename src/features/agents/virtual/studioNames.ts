interface Named {
  id: string;
  name: string;
  role?: string;
}

const key = (text: string) => text.trim().toLowerCase();

/**
 * The name each agent goes by in the studio. Most keep their own; where several share a name,
 * each is told apart by its role when the roles differ, and otherwise by a number in the order
 * they are listed, so "Codex" and "Codex 2" can be asked for by name.
 */
export function studioNames(agents: readonly Named[]): Map<string, string> {
  const groups = new Map<string, Named[]>();
  for (const agent of agents) {
    const group = groups.get(key(agent.name)) ?? [];
    group.push(agent);
    groups.set(key(agent.name), group);
  }
  const names = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length === 1) {
      names.set(group[0]!.id, group[0]!.name.trim());
      continue;
    }
    const roles = new Map<string, number>();
    for (const agent of group) {
      const role = key(agent.role ?? "");
      roles.set(role, (roles.get(role) ?? 0) + 1);
    }
    let number = 0;
    for (const agent of group) {
      const role = (agent.role ?? "").trim();
      number += 1;
      // A role only tells it apart when no other agent of the same name has it.
      if (role && roles.get(key(role)) === 1) names.set(agent.id, `${agent.name.trim()} · ${role}`);
      else names.set(agent.id, number === 1 ? agent.name.trim() : `${agent.name.trim()} ${number}`);
    }
  }
  return names;
}

/** The agent a typed name stands for, ignoring case; the longest name that fits wins. */
export function agentNamed(names: Map<string, string>, text: string): string | null {
  const typed = key(text);
  let found: string | null = null;
  let length = 0;
  for (const [id, name] of names) {
    const wanted = key(name);
    if (typed.startsWith(wanted) && wanted.length > length) {
      const next = typed[wanted.length];
      // A whole name only: "Codex" is not the start of "Codexes".
      if (next === undefined || !/[\p{L}\p{N}]/u.test(next)) [found, length] = [id, wanted.length];
    }
  }
  return found;
}

/**
 * The agents a message to the studio is for, and the message without their names: every
 * `@Name` in it, in order and once each. Names with spaces are matched whole.
 */
export function mentionsIn(
  names: Map<string, string>,
  text: string,
): { ids: string[]; message: string } {
  const ids: string[] = [];
  let message = "";
  let index = 0;
  while (index < text.length) {
    const at = text.indexOf("@", index);
    if (at < 0) break;
    const before = at === 0 ? " " : text[at - 1]!;
    const id = /\s/.test(before) ? agentNamed(names, text.slice(at + 1)) : null;
    if (!id) {
      message += text.slice(index, at + 1);
      index = at + 1;
      continue;
    }
    if (!ids.includes(id)) ids.push(id);
    message += text.slice(index, at);
    index = at + 1 + key(names.get(id)!).length;
    // A comma or colon right after a name only separates it from the next one or the message.
    while (index < text.length && /[,:]/.test(text[index]!)) index += 1;
  }
  message += text.slice(index);
  return { ids, message: message.replace(/\s+/g, " ").trim() };
}
