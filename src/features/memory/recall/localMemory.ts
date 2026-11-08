import { ApiRequestError } from "@/api/client/errors";
import { queryVector } from "@/api/runtime/device-embeddings";
import {
  deviceMemory,
  type DeviceMemoryEvent,
  type DeviceMemoryHit,
} from "@/api/runtime/device-memory";
import { deviceModelCall } from "@/api/runtime/device-models";
import { memorySpaceKey, windowSpaceId } from "./windowSpace";

/**
 * The app's Memory calls, answered by this computer (`src-tauri/features/memory`). The answers keep
 * the server's shapes, since the pages don't know which one they're talking to.
 */

const inWindow = (spaceId: string | undefined) => memorySpaceKey(spaceId ?? windowSpaceId());

const backlogMessage =
  "Memory is catching up, so new pages aren't being kept for now. It continues on its own once it has caught up.";

/** One Space's records nearest in meaning. With no embedding model there are none. */
export async function searchByMeaning(
  spaceId: string,
  branches: string[],
  query: string,
  limit: number | undefined,
  signal?: AbortSignal,
): Promise<DeviceMemoryHit[]> {
  const found = await queryVector(query, signal);
  if (!found) return [];
  return deviceMemory.search({ space_id: spaceId, branches, ...found, limit });
}

/** Events back in the order search ranked them. */
export function eventsInHitOrder(events: DeviceMemoryEvent[], ids: string[]): DeviceMemoryEvent[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

function cut(text: string, limit: number): string {
  const characters = [...text];
  return characters.length <= limit ? text : characters.slice(0, limit).join("");
}

export const localMemory = {
  record: async (event: Record<string, unknown> & { space_id?: string }) => {
    try {
      return await deviceMemory.record({ ...event, space_id: inWindow(event.space_id) });
    } catch (error) {
      // What the recorder backs off on, as it does from the server.
      if (error === "memory_backlog_full")
        throw new ApiRequestError(backlogMessage, 429, "memory_backlog_full");
      throw error;
    }
  },
  events: async (query: {
    from?: string;
    to?: string;
    site?: string;
    kind?: string;
    q?: string;
    limit?: number;
    space_id?: string;
  }) => {
    const { q, space_id, ...rest } = query;
    const space = inWindow(space_id);
    const text = q?.trim();
    if (!text) {
      const events = await deviceMemory.events({ ...rest, space_id: space });
      return { events };
    }
    const hits = await searchByMeaning(space, ["moments"], text, query.limit);
    const ids = hits.map((hit) => hit.record_id);
    if (!ids.length) return { events: [] };
    const events = await deviceMemory.events({ ...rest, space_id: space, ids });
    return { events: eventsInHitOrder(events, ids) };
  },
  forget: async (scope: { all?: boolean; site?: string; from?: string; to?: string }) => {
    const { forgotten } = await deviceMemory.forget({ ...scope, space_id: inWindow(undefined) });
    return { forgotten: forgotten ?? 0 };
  },
  status: () => deviceMemory.status(),
  hasRecap: async (date: string) => {
    const nodes = await deviceMemory.tree<{ id: string }>({
      space_id: inWindow(undefined),
      parent: "summaries",
    });
    return nodes.some((node) => node.id === `summary:recap-${date}`);
  },
  /**
   * One day's recap: this computer gathers the day's moments, its fast model writes it, and it stays
   * in the tree's Summaries. A recap that can't be kept is still shown.
   */
  daySummary: async (body: {
    date: string;
    time_zone: string;
    language?: string;
    space_id?: string;
  }) => {
    const space = inWindow(body.space_id);
    const start = new Date(`${body.date}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const events = await deviceMemory.events({
      space_id: space,
      from: start.toISOString(),
      to: end.toISOString(),
      limit: 200,
    });
    if (!events.length) return { markdown: "", topics: [], count: 0 };
    const clock = new Intl.DateTimeFormat("en-GB", {
      timeZone: body.time_zone || "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    // Oldest first, so they read as the day went.
    const items = [...events].reverse().map((event) => ({
      at: clock.format(new Date(event.occurred_at)),
      kind: event.kind,
      title: cut(event.title || event.url || "", 300),
      ...(event.site ? { site: event.site } : {}),
      ...(event.body ? { excerpt: cut(event.body, 400) } : {}),
    }));
    const written = await deviceModelCall<{
      markdown: string;
      topics: string[];
      threads: { title: string; from: string; to: string }[];
      next: string[];
    }>("day-summary", { date: body.date, items, language: body.language || undefined });
    await deviceMemory
      .saveRecap({
        space_id: space,
        date: body.date,
        markdown: written.markdown,
        outline: { threads: written.threads, next: written.next },
      })
      .catch(() => undefined);
    return { markdown: written.markdown, topics: written.topics, count: events.length };
  },
  exportZip: async () => new Blob([await deviceMemory.exportZip()], { type: "application/zip" }),
};
