import { apiRequest } from "@/api/client";
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
  events: (query: {
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
    return apiRequest<{ events: MemoryEvent[] }>(`/me/memory/events?${params}`);
  },
  forget: (scope: { all?: boolean; site?: string; from?: string; to?: string }) =>
    apiRequest<{ forgotten: number }>("/me/memory/forget", post(inSpace(scope))),
  status: () => apiRequest<MemoryStatus>("/me/memory/status"),
  daySummary: (body: { date: string; time_zone: string; language?: string }) =>
    apiRequest<{ markdown: string; topics: string[]; count: number }>(
      "/me/memory/day-summary",
      post(inSpace(body)),
    ),
  exportPath: "/me/memory/export",
};
