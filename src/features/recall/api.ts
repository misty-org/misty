import { apiRequest } from "@/api/client";

export type MemoryKind = "page" | "voice" | "recording" | "note";

export interface MemoryEvent {
  id: string;
  kind: MemoryKind;
  url?: string;
  site?: string;
  title: string;
  body?: string;
  same_as?: string;
  dwell_ms: number;
  occurred_at: string;
}

export interface MemoryStatus {
  waiting: number;
  cap: number;
  full: boolean;
  message?: string;
}

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

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
  }) => apiRequest<{ id: string; same_as: string }>("/me/memory/events", post(event)),
  events: (query: {
    from?: string;
    to?: string;
    site?: string;
    kind?: MemoryKind;
    q?: string;
    limit?: number;
  }) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined && value !== "") params.set(key, String(value));
    return apiRequest<{ events: MemoryEvent[] }>(`/me/memory/events?${params}`);
  },
  forget: (scope: { all?: boolean; site?: string; from?: string; to?: string }) =>
    apiRequest<{ forgotten: number }>("/me/memory/forget", post(scope)),
  status: () => apiRequest<MemoryStatus>("/me/memory/status"),
  daySummary: (body: { date: string; time_zone: string; language?: string }) =>
    apiRequest<{ markdown: string; topics: string[]; count: number }>(
      "/me/memory/day-summary",
      post(body),
    ),
  exportPath: "/me/memory/export",
};
