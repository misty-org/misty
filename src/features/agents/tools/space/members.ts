import type { LocalToolHandler } from "../host";
import { readRoute, refuse, spacePath } from "./api";
import { text } from "./args";
import { routedTool } from "./routing";

export interface Member {
  user_id: string;
  name: string;
  email: string;
  role: string;
}

export async function spaceMembers(
  request: Parameters<typeof readRoute>[0],
  spaceId: string,
): Promise<Member[]> {
  const { members } = await readRoute<{ members: Member[] }>(
    request,
    spacePath(spaceId, "/members"),
  );
  return members;
}

const sanitized = (members: Member[]) =>
  members.map(({ user_id, name, role }) => ({ user_id, name, role }));

/** Lowercase, plain quotes and dashes, single spaces: names written two ways still match. */
export function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, "-")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

/** Whether a phrase appears in a text as whole words. */
export function containsPhrase(value: string, phrase: string): boolean {
  const words = (input: string) =>
    normalizeName(input)
      .replace(/[^\p{L}\p{N}]/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
      .join(" ");
  const wanted = words(phrase);
  return wanted !== "" && ` ${words(value)} `.includes(` ${wanted} `);
}

function matchingMembers(members: Member[], query: string): Member[] {
  const wanted = normalizeName(query);
  const exact: Member[] = [];
  const partial: Member[] = [];
  for (const member of members) {
    const name = normalizeName(member.name);
    const email = normalizeName(member.email ?? "");
    if (wanted === name || wanted === email) exact.push(member);
    else if (name.includes(wanted) || email.includes(wanted)) partial.push(member);
  }
  return exact.length > 0 ? exact : partial;
}

const list = routedTool("read", async (request, space) => {
  const members = await spaceMembers(request, space.id);
  return { members: sanitized(members), count: members.length };
});

const resolve = routedTool("read", async (request, space) => {
  const query = text(request.input, "query", { max: 320 });
  if (!query.trim()) throw refuse("member query is required");
  const matches = matchingMembers(await spaceMembers(request, space.id), query);
  return { matches: sanitized(matches), count: matches.length, resolved: matches.length === 1 };
});

export const memberTools: Record<string, LocalToolHandler> = {
  "space.member.list": list,
  "space.member.resolve": resolve,
};
