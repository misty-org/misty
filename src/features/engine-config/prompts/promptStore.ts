// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * Prompts: Markdown files with `---` front matter (description, argument-hint) that the
 * composer's `!` menu inserts and Settings manages. Folder prompts live in the linked folder's
 * `.misty/prompts/`, global ones in Misty's own folder.
 *
 * One cache per folder ("" is global only), stale-while-revalidate with one request in flight
 * per folder, and a forced `refresh` so a change shows at once. Every change goes through the
 * helpers below: they refresh the folder and tell other surfaces with PROMPTS_CHANGED_EVENT.
 */

import { create } from "zustand";
import {
  createPromptFile,
  deletePromptFile,
  listPrompts,
  movePromptFile,
  updatePromptFile,
  type CustomPromptEntry,
  type PromptInput,
  type PromptScope,
  type PromptUpdates,
} from "./promptsApi";

/** Sent after any prompt change; the detail carries the folder. */
export const PROMPTS_CHANGED_EVENT = "misty:prompts-changed";

/** Listens for prompt changes; `folder` is the affected folder, null when none was given. */
export function subscribePromptsChanged(listener: (folder: string | null) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ root?: string }>).detail;
    listener(detail?.root ?? null);
  };
  window.addEventListener(PROMPTS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(PROMPTS_CHANGED_EVENT, handler);
}

function notifyPromptsChanged(root: string): void {
  window.dispatchEvent(new CustomEvent(PROMPTS_CHANGED_EVENT, { detail: { root } }));
}

/** One folder's cached prompts. */
export interface RootPrompts {
  entries: CustomPromptEntry[];
  status: "loading" | "ready" | "error";
  fetchedAt: number;
}

const PROMPTS_TTL_MS = 60_000;

interface PromptStore {
  byRoot: Record<string, RootPrompts>;
  /** Fetches once per folder, then again only once stale; concurrent calls share one request. */
  ensure: (root: string) => void;
  /** Fetches again whatever the age. Never rejects: a failure keeps the previous entries. */
  refresh: (root: string) => Promise<void>;
}

const inFlight = new Map<string, Promise<void>>();

export const usePromptStore = create<PromptStore>()((set, get) => {
  const load = (root: string): Promise<void> => {
    const existing = inFlight.get(root);
    if (existing) return existing;
    const pending = listPrompts(root)
      .then((entries) => {
        set((s) => {
          // Dropped while the request was out: stay gone.
          if (!(root in s.byRoot)) return {};
          return {
            byRoot: { ...s.byRoot, [root]: { entries, status: "ready", fetchedAt: Date.now() } },
          };
        });
      })
      .catch(() => {
        set((s) => {
          if (!(root in s.byRoot)) return {};
          const prev = s.byRoot[root];
          return {
            byRoot: {
              ...s.byRoot,
              // A failed refresh keeps serving the old entries; only a failed first fetch
              // leaves the menu empty.
              [root]: {
                entries: prev?.entries ?? [],
                status: "error",
                fetchedAt: prev?.fetchedAt ?? 0,
              },
            },
          };
        });
      })
      .finally(() => {
        inFlight.delete(root);
      });
    inFlight.set(root, pending);
    return pending;
  };

  const startLoading = (root: string) => {
    set((s) => ({
      byRoot: { ...s.byRoot, [root]: { entries: [], status: "loading", fetchedAt: 0 } },
    }));
  };

  return {
    byRoot: {},
    ensure: (root) => {
      const cur = get().byRoot[root];
      if (cur && cur.status === "ready" && Date.now() - cur.fetchedAt < PROMPTS_TTL_MS) return;
      if (!cur) startLoading(root);
      void load(root);
    },
    refresh: (root) => {
      if (!get().byRoot[root]) startLoading(root);
      return load(root);
    },
  };
});

/** The folder's prompts, read once and then from the cache, for the composer's menu. */
export async function promptsFor(root: string): Promise<CustomPromptEntry[]> {
  const store = usePromptStore.getState();
  const cur = store.byRoot[root];
  if (cur?.status === "ready" && Date.now() - cur.fetchedAt < PROMPTS_TTL_MS) return cur.entries;
  await store.refresh(root);
  return usePromptStore.getState().byRoot[root]?.entries ?? [];
}

// Each helper tells other surfaces before refreshing, so their refreshes join this one.

export async function createPrompt(
  root: string,
  scope: PromptScope,
  input: PromptInput,
): Promise<CustomPromptEntry> {
  const entry = await createPromptFile(root, scope, input);
  notifyPromptsChanged(root);
  await usePromptStore.getState().refresh(root);
  return entry;
}

export async function updatePrompt(
  root: string,
  promptPath: string,
  updates: PromptUpdates,
): Promise<CustomPromptEntry> {
  const entry = await updatePromptFile(root, promptPath, updates);
  notifyPromptsChanged(root);
  await usePromptStore.getState().refresh(root);
  return entry;
}

export async function deletePrompt(root: string, promptPath: string): Promise<void> {
  await deletePromptFile(root, promptPath);
  notifyPromptsChanged(root);
  await usePromptStore.getState().refresh(root);
}

export async function movePrompt(
  root: string,
  promptPath: string,
  scope: PromptScope,
): Promise<CustomPromptEntry> {
  const entry = await movePromptFile(root, promptPath, scope);
  notifyPromptsChanged(root);
  await usePromptStore.getState().refresh(root);
  return entry;
}

// A change from any surface refreshes that folder's cache (every cached folder when none is
// named). Global prompts show in every folder, so a change anywhere refreshes the rest too.
if (typeof window !== "undefined") {
  subscribePromptsChanged((root) => {
    const { byRoot, refresh } = usePromptStore.getState();
    for (const key of Object.keys(byRoot)) if (key !== root) void refresh(key);
  });
}

/** The `!` menu's filter: any of name, description and body contains the query, in order. */
export function matchPrompts(entries: CustomPromptEntry[], query: string): CustomPromptEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    (entry) =>
      entry.name.toLowerCase().includes(q) ||
      (entry.description ?? "").toLowerCase().includes(q) ||
      entry.content.toLowerCase().includes(q),
  );
}
