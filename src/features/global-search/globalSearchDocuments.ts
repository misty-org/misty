import { messageReplyPreviewText } from "@/features/spaces/chat";
import { spaceChatPath, useSpacesStore } from "@/features/spaces";
import type { GlobalSearchDocument, GlobalSearchResult } from "./types";

let lastIndex:
  | {
      accountId: string;
      state: ReturnType<typeof useSpacesStore.getState>;
      documents: GlobalSearchDocument[];
    }
  | undefined;

/**
 * Every local document, rebuilt only when the Spaces store changes. The address bar
 * searches this on each keystroke, so building it every time stalled typing.
 */
export function buildLocalIndex(accountId: string): GlobalSearchDocument[] {
  const state = useSpacesStore.getState();
  if (lastIndex?.accountId === accountId && lastIndex.state === state) return lastIndex.documents;
  const documents = buildDocuments(accountId, state);
  lastIndex = { accountId, state, documents };
  return documents;
}

function buildDocuments(
  accountId: string,
  state: ReturnType<typeof useSpacesStore.getState>,
): GlobalSearchDocument[] {
  const spacesById = new Map(state.spaces.map((space) => [space.id, space]));
  const documents: GlobalSearchDocument[] = state.spaces.map((space) => ({
    id: `space:${space.id}`,
    accountId,
    kind: "space",
    title: space.name,
    body: `${space.member_count} member${space.member_count === 1 ? "" : "s"}`,
    keywords: [space.role, "space"],
    href: `/spaces/${encodeURIComponent(space.id)}`,
    spaceId: space.id,
    spaceName: space.name,
    updatedAt: space.updated_at,
    source: "local",
  }));

  for (const [spaceId, messages] of Object.entries(state.messagesBySpace)) {
    const space = spacesById.get(spaceId);
    if (!space) continue;
    for (const message of messages.slice(-80)) {
      const body = messageReplyPreviewText(message);
      if (!body) continue;
      documents.push({
        id: `message:${message.id}`,
        accountId,
        kind: "message",
        title: message.sender_name || "Message",
        body,
        keywords: [space.name, "chat", "message"],
        href: spaceChatPath(spaceId, new URLSearchParams({ message: message.id })),
        spaceId,
        spaceName: space.name,
        updatedAt: message.created_at,
        source: "local",
      });
    }
  }

  for (const [spaceId, nodes] of Object.entries(state.nodesBySpace)) {
    const space = spacesById.get(spaceId);
    if (!space) continue;
    for (const node of nodes) {
      documents.push({
        id: `library:${node.id}`,
        accountId,
        kind: "library",
        title: node.display_name,
        body: node.mime_type || node.kind,
        keywords: [space.name, "library", node.kind],
        href: `/spaces/${encodeURIComponent(spaceId)}/library`,
        spaceId,
        spaceName: space.name,
        updatedAt: node.updated_at,
        source: "local",
      });
    }
  }

  return documents;
}

export function searchDocuments(
  documents: GlobalSearchDocument[],
  query: string,
  limit: number,
): GlobalSearchResult[] {
  const terms = normalize(query).split(" ").filter(Boolean);
  return documents
    .map((document) => ({ ...document, score: scoreDocument(document, terms) }))
    .filter((document) => document.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || recency(right.updatedAt) - recency(left.updatedAt),
    )
    .slice(0, limit);
}

function scoreDocument(document: GlobalSearchDocument, terms: string[]): number {
  const title = normalize(document.title);
  const body = normalize(document.body);
  const keywords = normalize(document.keywords.join(" "));
  let score = 0;
  for (const term of terms) {
    const titleFuzzy = fuzzyFieldScore(title, term);
    const keywordFuzzy = fuzzyFieldScore(keywords, term);
    const bodyFuzzy = fuzzyFieldScore(body, term);
    if (!titleFuzzy && !keywordFuzzy && !bodyFuzzy) return 0;
    if (title === term) score += 12;
    else if (title.startsWith(term)) score += 8;
    else if (title.includes(term)) score += 6;
    else score += titleFuzzy * 4;
    if (keywords.includes(term)) score += 3;
    else score += keywordFuzzy * 2;
    if (body.includes(term)) score += 1;
    else score += bodyFuzzy;
  }
  return score + Math.max(0, 1 - (Date.now() - recency(document.updatedAt)) / 2.592e9);
}

/**
 * Reciprocal-rank fusion keeps lexical, semantic, device, and cloud scores in
 * their native domains. Raw similarity scores from those systems are not
 * comparable, but their rank positions are stable and useful.
 */
export function fuseRankedResults(lists: GlobalSearchResult[][], limit: number) {
  const fused = new Map<string, { result: GlobalSearchResult; score: number }>();
  lists.forEach((list, listIndex) => {
    const weight = listIndex === 0 ? 1.15 : 1;
    list.forEach((result, rank) => {
      const key = result.canonicalId ?? canonicalResultKey(result);
      const contribution = weight / (40 + rank + 1);
      const current = fused.get(key);
      if (!current) fused.set(key, { result, score: contribution });
      else {
        current.score += contribution;
        if ((result.body?.length ?? 0) > (current.result.body?.length ?? 0)) {
          current.result = { ...current.result, ...result };
        }
      }
    });
  });
  return [...fused.values()]
    .map(({ result, score }) => ({ ...result, score: score * 1_000 }))
    .sort(
      (left, right) =>
        right.score - left.score || recency(right.updatedAt) - recency(left.updatedAt),
    )
    .slice(0, limit);
}

function canonicalResultKey(result: GlobalSearchResult) {
  return `${result.kind}:${result.id.replace(/^(activity|file|task|space|message|library|note|calendar|roadmap|provider):/, "")}`;
}

function fuzzyFieldScore(field: string, term: string) {
  if (term.length < 3) return 0;
  const tokens = field.split(" ").filter(Boolean);
  let best = 0;
  for (const token of tokens) {
    if (token.startsWith(term) || term.startsWith(token)) best = Math.max(best, 0.9);
    else if (Math.abs(token.length - term.length) <= 2 && editDistanceWithin(token, term, 2)) {
      best = Math.max(best, 0.68);
    }
  }
  return best;
}

function editDistanceWithin(left: string, right: string, maximum: number) {
  if (Math.abs(left.length - right.length) > maximum) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowMinimum = i;
    for (let j = 1; j <= right.length; j += 1) {
      const value = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      current[j] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximum) return false;
    previous = current;
  }
  return previous[right.length] <= maximum;
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function recency(value?: string): number {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}
