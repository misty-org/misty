import { activityTargetHref, useActivityStore } from "@/features/activity";
import { messageReplyPreviewText } from "@/features/spaces/chat";
import { useSpacesStore } from "@/features/spaces";
import type { SearchResult } from "@/native/contracts";
import { spacesApi } from "@/api/spaces/api";
import type { GlobalSearchContextItem, GlobalSearchDocument, GlobalSearchResult } from "./types";

export function globalSearchContext(
  results: GlobalSearchResult[],
  limit = 12,
): GlobalSearchContextItem[] {
  return results.slice(0, limit).map((result) => ({
    kind: result.kind,
    title: result.title,
    snippet: result.body.slice(0, 280),
    href: result.href,
    ...(result.spaceName ? { space: result.spaceName } : {}),
    source: result.source,
  }));
}

export function buildLocalIndex(accountId: string): GlobalSearchDocument[] {
  const state = useSpacesStore.getState();
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
    if (!space || space.permissions?.["messages.read"] !== true) continue;
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
        href: `/spaces/${encodeURIComponent(spaceId)}/chat?message=${encodeURIComponent(message.id)}`,
        spaceId,
        spaceName: space.name,
        updatedAt: message.created_at,
        source: "local",
      });
    }
  }

  for (const [spaceId, nodes] of Object.entries(state.nodesBySpace)) {
    const space = spacesById.get(spaceId);
    if (!space || space.permissions?.["library.view"] !== true) continue;
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

  for (const item of useActivityStore.getState().allItems) {
    if (item.accountId !== accountId) continue;
    if (item.target.kind === "space" || item.target.kind === "space-chat") {
      const space = spacesById.get(item.target.spaceId);
      if (!space || (item.target.kind === "space-chat" && !space.permissions?.["messages.read"]))
        continue;
    }
    if (item.target.kind === "space-task") {
      const space = spacesById.get(item.target.spaceId);
      if (!space || !space.permissions?.["tasks.view"]) continue;
    }
    const href = activityTargetHref(item.target);
    if (!href) continue;
    documents.push({
      id: `activity:${item.id}`,
      accountId,
      kind: "activity",
      title: item.title,
      body: item.body,
      keywords: [item.kind, "activity", item.attention ? "important" : "update"],
      href,
      updatedAt: item.createdAt,
      source: "local",
    });
  }

  for (const [spaceId, resources] of Object.entries(state.agentsBySpace)) {
    const space = spacesById.get(spaceId);
    if (!space) continue;
    for (const resource of resources)
      documents.push(resourceDocument(accountId, spaceId, space.name, resource, "agent"));
  }
  for (const [spaceId, resources] of Object.entries(state.workflowsBySpace)) {
    const space = spacesById.get(spaceId);
    if (!space) continue;
    for (const resource of resources)
      documents.push(resourceDocument(accountId, spaceId, space.name, resource, "workflow"));
  }
  for (const space of state.spaces) {
    if (space.permissions?.["tasks.create"] !== true) continue;
    documents.push({
      id: `action:create-task:${space.id}`,
      accountId,
      kind: "action",
      title: `Create a task in ${space.name}`,
      body: "Ask Misty to create and assign a task.",
      keywords: [space.name, "create", "task", "action"],
      href: `/spaces/${encodeURIComponent(space.id)}/planner/tasks/board?create=task`,
      spaceId: space.id,
      spaceName: space.name,
      source: "local",
    });
  }
  return documents;
}

function resourceDocument(
  accountId: string,
  spaceId: string,
  spaceName: string,
  resource: { id: string; name: string; description?: string; updated_at: string },
  kind: "agent" | "workflow",
): GlobalSearchDocument {
  return {
    id: `${kind}:${resource.id}`,
    accountId,
    kind,
    title: resource.name,
    body: resource.description ?? "",
    keywords: [spaceName, kind],
    href: `/spaces/${encodeURIComponent(spaceId)}/assistant/studio/${kind === "agent" ? "agents" : "workflows"}`,
    spaceId,
    spaceName,
    updatedAt: resource.updated_at,
    source: "local",
  };
}

export async function searchServerTasks(
  accountId: string,
  query: string,
  spaces: ReturnType<typeof useSpacesStore.getState>["spaces"],
): Promise<GlobalSearchDocument[]> {
  const readable = spaces
    .filter((space) => space.permissions?.["tasks.view"] === true)
    .slice(0, 10);
  const responses = await Promise.allSettled(
    readable.map(async (space) => ({
      space,
      page: await spacesApi.tasks(space.id, { search: query, limit: 5, sort: "updated" }),
    })),
  );
  return responses.flatMap((response) =>
    response.status === "fulfilled"
      ? response.value.page.tasks.map((task) => ({
          id: `task:${task.id}`,
          accountId,
          kind: "task" as const,
          title: task.title,
          body: task.notes,
          keywords: [task.task_key, task.status, task.priority, response.value.space.name],
          href: `/spaces/${encodeURIComponent(task.space_id)}/planner/tasks/board?task=${encodeURIComponent(task.id)}`,
          spaceId: task.space_id,
          spaceName: response.value.space.name,
          updatedAt: task.updated_at,
          source: "server" as const,
        }))
      : [],
  );
}

export function mapFileResults(results: SearchResult[], accountId: string): GlobalSearchDocument[] {
  return results.map((result) => {
    const remotePath =
      result.entry.location.kind === "remote" ? result.entry.location.remotePath : "";
    const isSpaceLibrary =
      result.entry.location.kind === "remote" &&
      result.entry.location.providerType === "misty-space";
    return {
      id: `file:${result.entry.path}`,
      accountId,
      kind: isSpaceLibrary ? "library" : result.entry.kind === "folder" ? "folder" : "file",
      title: result.entry.name,
      body: result.match?.description || result.match?.extractedText || result.entry.path,
      keywords: [result.match?.assetKind ?? result.entry.kind, ...(result.match?.tags ?? [])],
      href: isSpaceLibrary && remotePath ? remotePath : "/files",
      ...(result.entry.remoteModified ? { updatedAt: result.entry.remoteModified } : {}),
      source: isSpaceLibrary ? "server" : result.sourceKind === "local" ? "device" : "server",
      fileResult: result,
    };
  });
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
    if (!title.includes(term) && !keywords.includes(term) && !body.includes(term)) return 0;
    if (title === term) score += 12;
    else if (title.startsWith(term)) score += 8;
    else if (title.includes(term)) score += 6;
    if (keywords.includes(term)) score += 3;
    if (body.includes(term)) score += 1;
  }
  return score + Math.max(0, 1 - (Date.now() - recency(document.updatedAt)) / 2.592e9);
}

export function mergeResults(
  local: GlobalSearchResult[],
  remote: GlobalSearchResult[],
  limit: number,
) {
  const merged = new Map<string, GlobalSearchResult>();
  for (const result of [...local, ...remote]) {
    const key = `${result.kind}:${result.id.replace(/^(activity|file|task|space|message|library):/, "")}`;
    const existing = merged.get(key);
    if (!existing || result.score > existing.score) merged.set(key, result);
  }
  return [...merged.values()].sort((left, right) => right.score - left.score).slice(0, limit);
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
