import { apiRequest } from "@/api/client";
import { queryEmbeddingHeaders } from "@/api/device-embeddings";
import { deviceModelCall } from "@/api/device-models";
import { windowSpaceId } from "./windowSpace";

export type MemoryKind = "page" | "voice" | "recording" | "note" | "screen";

export interface MemoryEvent {
  id: string;
  space_id: string;
  kind: MemoryKind;
  url?: string;
  site?: string;
  title: string;
  body?: string;
  same_as?: string;
  dwell_ms: number;
  occurred_at: string;
  /** What was in front, and the capture session that read it (screen moments). */
  app?: string;
  window_title?: string;
  session_id?: string;
}

export interface MemoryStatus {
  waiting: number;
  cap: number;
  full: boolean;
  message?: string;
}

interface DaySummary {
  markdown: string;
  topics: string[];
  count: number;
}

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

/**
 * Every call names the window's Space: memory is one tree per Space on the
 * server. Without one the server uses the personal Space.
 */
const inSpace = <T extends object>(body: T) => ({ ...body, space_id: windowSpaceId() });

export const memoryApi = {
  record: (event: {
    kind: MemoryKind;
    url?: string;
    title: string;
    body?: string;
    simhash?: string;
    dwell_ms?: number;
    occurred_at?: string;
    ref_id?: string;
    app?: string;
    window_title?: string;
    session_id?: string;
    /** The Space of the window the page was in; incognito windows record nothing. */
    space_id?: string;
  }) =>
    apiRequest<{ id: string; same_as: string }>(
      "/me/memory/events",
      post({ ...event, space_id: event.space_id ?? windowSpaceId() }),
    ),
  events: async (query: {
    from?: string;
    to?: string;
    site?: string;
    kind?: MemoryKind;
    q?: string;
    limit?: number;
  }) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...query, space_id: windowSpaceId() }))
      if (value !== undefined && value !== "") params.set(key, String(value));
    // Search by meaning carries its vector from this computer's embedding model.
    const headers = query.q ? await queryEmbeddingHeaders(query.q) : {};
    return apiRequest<{ events: MemoryEvent[] }>(`/me/memory/events?${params}`, { headers });
  },
  forget: (scope: { all?: boolean; site?: string; from?: string; to?: string }) =>
    apiRequest<{ forgotten: number }>("/me/memory/forget", post(inSpace(scope))),
  status: () => apiRequest<MemoryStatus>("/me/memory/status"),
  /** The server gathers the day's moments; this computer's fast model writes the summary. */
  daySummary: async (body: { date: string; time_zone: string; language?: string }) => {
    const day = await apiRequest<DaySummary & { on_device?: boolean; items?: unknown[] }>(
      "/me/memory/day-summary",
      post(inSpace(body)),
    );
    if (!day.on_device) return day;
    const written = await deviceModelCall<{ markdown: string; topics: string[] }>("day-summary", {
      date: body.date,
      items: day.items,
      language: body.language || undefined,
    });
    return { markdown: written.markdown, topics: written.topics, count: day.count };
  },
  exportPath: "/me/memory/export",
};
