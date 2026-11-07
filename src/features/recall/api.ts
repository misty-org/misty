import type { DeviceMemoryEvent } from "@/api/device-memory";
import { localMemory } from "./localMemory";

export type MemoryKind = "page" | "voice" | "recording" | "note" | "screen";

export type MemoryEvent = DeviceMemoryEvent;

export interface MemoryStatus {
  waiting: number;
  cap: number;
  full: boolean;
  message?: string;
}

export interface DaySummary {
  markdown: string;
  topics: string[];
  count: number;
}

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
  }) => localMemory.record(event),
  events: async (query: {
    from?: string;
    to?: string;
    site?: string;
    kind?: MemoryKind;
    q?: string;
    limit?: number;
    /** The Space to read; without one, the window's. */
    space_id?: string;
  }): Promise<{ events: MemoryEvent[] }> => localMemory.events(query),
  forget: (scope: { all?: boolean; site?: string; from?: string; to?: string }) =>
    localMemory.forget(scope),
  status: (): Promise<MemoryStatus> => localMemory.status(),
  /** Whether a day already has its recap in the tree's Summaries. */
  hasRecap: (date: string) => localMemory.hasRecap(date),
  /** One day's recap, written on this computer's fast model and kept in the tree's Summaries. */
  daySummary: (body: {
    date: string;
    time_zone: string;
    language?: string;
    space_id?: string;
  }): Promise<DaySummary> => localMemory.daySummary(body),
  /** Everything Memory kept, as a zip. */
  exportZip: () => localMemory.exportZip(),
};
