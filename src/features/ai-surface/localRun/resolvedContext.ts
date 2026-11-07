import { apiRequest } from "@/api/client";
import { spacePath } from "@/features/agents/localRun";
import type { AiCitation, AiContextReference } from "../types";

/**
 * The content behind what a person attached, ready for the prompt's source tags
 * (`ai_context_broker.go`). Each comes through the normal signed-in routes, so the server checks it
 * like any request of theirs. One that can't be read is left out, never guessed at.
 */

const maxReferences = 64;
const maxChunk = 8_000;

export interface ResolvedSource {
  kind: string;
  title: string;
  content: string;
  citation: AiCitation;
}

interface ChatMessage {
  created_at: string;
  sender_name: string;
  content: { type: string; text?: string; label?: string }[];
}

const excerpt = (text: string) => {
  const clean = text.split(/\s+/).filter(Boolean).join(" ");
  return [...clean].length > 240 ? `${[...clean].slice(0, 239).join("")}…` : clean;
};

/** Long sources are cut around what the reference names, or from the start. */
function relevantChunk(content: string, query: string): string {
  const text = content.trim();
  if ([...text].length <= maxChunk) return text;
  const at = query.trim() ? text.toLowerCase().indexOf(query.trim().toLowerCase()) : -1;
  const start = Math.max(0, at - 800);
  return text.slice(start, start + maxChunk);
}

const firstText = (...values: (string | undefined)[]) =>
  values.find((value) => value?.trim())?.trim() ?? "";

const spansText = (spans: ChatMessage["content"]) =>
  spans
    .map((span) => (span.type === "text" ? (span.text ?? "") : span.label ? `@${span.label}` : ""))
    .join("")
    .trim();

async function note(reference: AiContextReference, spaceId: string): Promise<ResolvedSource> {
  const note = await apiRequest<{ id: string; title: string; markdown?: string; revision?: unknown }>(
    spacePath(spaceId, `/notes/${encodeURIComponent(reference.id)}`),
  );
  const body = (note.markdown ?? "").trim();
  const title = firstText(note.title, reference.title, "Note");
  return {
    kind: "note",
    title,
    content: body,
    citation: {
      id: note.id,
      kind: "note",
      title,
      href: `/spaces/${encodeURIComponent(spaceId)}/notes?note=${encodeURIComponent(note.id)}`,
      revision: note.revision as AiCitation["revision"],
      excerpt: excerpt(body),
    },
  };
}

async function chat(reference: AiContextReference, spaceId: string): Promise<ResolvedSource> {
  const everyone = reference.id === "everyone" || reference.id === spaceId;
  const path = everyone
    ? spacePath(spaceId, "/messages?limit=100")
    : spacePath(spaceId, `/conversations/${encodeURIComponent(reference.id)}/messages?limit=100`);
  const { messages } = await apiRequest<{ messages: ChatMessage[] }>(path);
  const lines = messages.flatMap((message) => {
    const text = spansText(message.content);
    return text ? [`${message.created_at} — ${message.sender_name}: ${text}`] : [];
  });
  const title = firstText(reference.title, "Space chat");
  const href = `/spaces/${encodeURIComponent(spaceId)}/chat`;
  return {
    kind: "space.chat",
    title,
    content: relevantChunk(lines.join("\n"), reference.title),
    citation: {
      id: reference.id,
      kind: "space.chat",
      title,
      href: everyone ? href : `${href}?conversation=${encodeURIComponent(reference.id)}`,
      excerpt: "Recent messages in the visible conversation",
    },
  };
}

async function libraryItem(reference: AiContextReference, spaceId: string): Promise<ResolvedSource> {
  const item = await apiRequest<{
    id: string;
    display_name: string;
    caption: string;
    tags: string[];
    version?: unknown;
    file?: { original_filename?: string; intrinsic_metadata?: unknown };
  }>(spacePath(spaceId, `/library/items/${encodeURIComponent(reference.id)}`));
  const content = [
    item.display_name,
    `Caption: ${item.caption ?? ""}`,
    `Tags: ${(item.tags ?? []).join(", ")}`,
    `Original filename: ${item.file?.original_filename ?? ""}`,
    `Intrinsic metadata: ${JSON.stringify(item.file?.intrinsic_metadata ?? null)}`,
  ].join("\n");
  return {
    kind: "library.item",
    title: item.display_name,
    content: relevantChunk(content, reference.title),
    citation: {
      id: item.id,
      kind: "library.item",
      title: item.display_name,
      href: `/spaces/${encodeURIComponent(spaceId)}/library?item=${encodeURIComponent(item.id)}`,
      revision: item.version as AiCitation["revision"],
      excerpt: excerpt(item.caption ?? ""),
    },
  };
}

async function drawing(reference: AiContextReference, spaceId: string): Promise<ResolvedSource> {
  const drawing = await apiRequest<{
    id: string;
    title: string;
    role?: string;
    collaboration_revision?: number;
  }>(spacePath(spaceId, `/drawings/${encodeURIComponent(reference.id)}`));
  return {
    kind: "drawing",
    title: drawing.title,
    content: `Drawing: ${drawing.title}\nCollaboration revision: ${drawing.collaboration_revision ?? 0}\nRole: ${drawing.role ?? ""}`,
    citation: {
      id: drawing.id,
      kind: "drawing",
      title: drawing.title,
      href: `/spaces/${encodeURIComponent(spaceId)}/drawings/${encodeURIComponent(drawing.id)}`,
      revision: drawing.collaboration_revision,
      excerpt: "Collaborative drawing metadata",
    },
  };
}

/** A container is a list of sources, not an eager read: each is checked when a tool reads it. */
function workspaceScope(reference: AiContextReference): ResolvedSource | null {
  const members = reference.metadata?.members;
  if (typeof members !== "string" || members.length > 64 << 10) return null;
  try {
    JSON.parse(members);
  } catch {
    return null;
  }
  return {
    kind: reference.kind,
    title: reference.title,
    content: `Search only these attached source references. Contents have not been loaded: ${members}`,
    citation: { id: reference.id, kind: reference.kind, title: reference.title, href: "" },
  };
}

async function resolveOne(reference: AiContextReference): Promise<ResolvedSource | null> {
  const spaceId = reference.spaceId?.trim() ?? "";
  switch (reference.kind.trim().toLowerCase()) {
    case "note":
    case "notes":
      return spaceId ? note(reference, spaceId) : null;
    case "space.chat":
      return spaceId ? chat(reference, spaceId) : null;
    case "library.item":
      return spaceId ? libraryItem(reference, spaceId) : null;
    case "drawing":
      return spaceId ? drawing(reference, spaceId) : null;
    case "workspace.scope":
      return workspaceScope(reference);
    // Labels are orientation, and device references are read by the tools bound to them.
    default:
      return null;
  }
}

/** Everything a run's references resolve to. Signed out there's nothing to fetch. */
export async function resolveContext(
  references: AiContextReference[],
  signedIn: boolean,
): Promise<ResolvedSource[]> {
  if (!signedIn) return [];
  const seen = new Set<string>();
  const unique = references.slice(0, maxReferences).filter((reference) => {
    const identity = `${reference.kind}:${reference.id}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  const settled = await Promise.allSettled(unique.map(resolveOne));
  return settled.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
}
