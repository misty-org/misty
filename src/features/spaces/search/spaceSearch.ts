import { spaceRequest } from "../api/api";
import type { SpaceMessage } from "../api/dto/core";
import { spaceChatConversationPath, spaceChatPath } from "../chat/chatRoute";
import { spansToText } from "../chat/components/messageText";
import { dayKey, eventTimes } from "../calendar/calendarDates";
import { notesApi } from "../journal/notes/api/api";
import { plannerApi, type SpaceCalendarEvent, type SpaceTask } from "../planner/api";

/**
 * What ⌘K search finds in a Space. Notes and messages are searched by the server, which reads
 * Space content anyway; tasks and events are read whole (a Space has few) and matched here.
 */
export interface SpaceSearchHit {
  kind: "note" | "message" | "task" | "event";
  id: string;
  title: string;
  /** The text the words were found in, or what the item says about itself. */
  text: string;
  href: string;
  updatedAt?: string;
}

const base = (spaceId: string) => `/spaces/${encodeURIComponent(spaceId)}`;

/** Notes and messages whose text has the words, best match first. */
export async function searchSpaceText(
  spaceId: string,
  query: string,
  signal?: AbortSignal,
): Promise<SpaceSearchHit[]> {
  const words = query.trim();
  if (!spaceId || !words) return [];
  const notes = new URLSearchParams({ q: words, space_id: spaceId, kinds: "note", limit: "20" });
  const [found, said] = await Promise.allSettled([
    spaceRequest<{ results: { kind: string; id: string; title: string; excerpt: string }[] }>(
      `/search?${notes}`,
      { signal },
    ),
    spaceRequest<{ messages: SpaceMessage[] }>(
      `${base(spaceId)}/messages/search?${new URLSearchParams({ q: words, limit: "20" })}`,
      { signal },
    ),
  ]);
  const hits: SpaceSearchHit[] = [];
  if (found.status === "fulfilled")
    for (const result of found.value.results ?? [])
      if (result.kind === "note")
        hits.push({
          kind: "note",
          id: result.id,
          title: result.title || "Untitled doc",
          text: result.excerpt,
          href: `${base(spaceId)}/notes?note=${encodeURIComponent(result.id)}`,
        });
  if (said.status === "fulfilled")
    for (const message of said.value.messages ?? [])
      hits.push({
        kind: "message",
        id: message.id,
        title: message.sender_name || "Message",
        text: spansToText(message.content),
        href: message.conversation_id
          ? spaceChatConversationPath(spaceId, message.conversation_id)
          : spaceChatPath(spaceId),
        updatedAt: message.created_at,
      });
  signal?.throwIfAborted();
  return hits;
}

const listCache = new Map<string, { at: number; value: Promise<SpaceSearchHit[]> }>();
/** A Space's lists change slowly next to typing; one read serves a minute of searches. */
function cached(key: string, load: () => Promise<SpaceSearchHit[]>) {
  const known = listCache.get(key);
  if (known && Date.now() - known.at < 60_000) return known.value;
  const value = load().catch((error) => {
    listCache.delete(key);
    throw error;
  });
  listCache.set(key, { at: Date.now(), value });
  return value;
}

function taskHit(spaceId: string, task: SpaceTask): SpaceSearchHit {
  return {
    kind: "task",
    id: task.id,
    title: task.title,
    text: task.notes,
    href: `${base(spaceId)}/planner?task=${encodeURIComponent(task.id)}`,
    updatedAt: task.updated_at ?? task.created_at,
  };
}

function eventHit(spaceId: string, event: SpaceCalendarEvent): SpaceSearchHit {
  const params = new URLSearchParams({ event: event.id, at: event.starts_at });
  return {
    kind: "event",
    id: event.id,
    title: event.title,
    text: [event.location, event.description].filter(Boolean).join(" · "),
    href: `${base(spaceId)}/calendar?${params}`,
    updatedAt: event.starts_at,
  };
}

/** Every open task on the Space's board. */
export function spaceTasks(spaceId: string): Promise<SpaceSearchHit[]> {
  return cached(`tasks:${spaceId}`, async () =>
    (await plannerApi.tasks(spaceId)).tasks.map((task) => taskHit(spaceId, task)),
  );
}

/** The Space's events from a year back to a year ahead. */
export function spaceEvents(spaceId: string): Promise<SpaceSearchHit[]> {
  return cached(`events:${spaceId}`, async () => {
    const year = 365 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const { events } = await plannerApi.events(
      spaceId,
      new Date(now - year).toISOString(),
      new Date(now + year).toISOString(),
    );
    return events.map((event) => eventHit(spaceId, event));
  });
}

/** Makes a task from search, and says where it opens. */
export async function createSpaceTask(spaceId: string, title: string) {
  listCache.delete(`tasks:${spaceId}`);
  const task = await plannerApi.createTask(spaceId, { title });
  return taskHit(spaceId, task).href;
}

export async function createSpaceNote(spaceId: string, title: string) {
  const note = await notesApi.create(spaceId, title);
  return `${base(spaceId)}/notes?note=${encodeURIComponent(note.id)}`;
}

/** An all-day event today, opened so its time can be set. */
export async function createSpaceEvent(spaceId: string, title: string) {
  listCache.delete(`events:${spaceId}`);
  const times = eventTimes(dayKey(new Date()), true, "09:00", "10:00");
  if (!times) throw new Error("That day couldn’t be read.");
  const event = await plannerApi.createEvent(spaceId, {
    title,
    description: "",
    location: "",
    all_day: true,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    ...times,
  });
  return eventHit(spaceId, event).href;
}
