// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

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
} from "./prompts_api";

const PROMPTS_CHANGED_EVENT = "misty:prompts-changed";

function subscribePromptsChanged(listener: (folder: string | null) => void): () => void {
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

interface RootPrompts {
  entries: CustomPromptEntry[];
  status: "loading" | "ready" | "error";
  fetchedAt: number;
}

const PROMPTS_TTL_MS = 60_000;

interface PromptStore {
  byRoot: Record<string, RootPrompts>;
  ensure: (root: string) => void;
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

export async function promptsFor(root: string): Promise<CustomPromptEntry[]> {
  const store = usePromptStore.getState();
  const cur = store.byRoot[root];
  if (cur?.status === "ready" && Date.now() - cur.fetchedAt < PROMPTS_TTL_MS) return cur.entries;
  await store.refresh(root);
  return usePromptStore.getState().byRoot[root]?.entries ?? [];
}

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

if (typeof window !== "undefined") {
  subscribePromptsChanged((root) => {
    const { byRoot, refresh } = usePromptStore.getState();
    for (const key of Object.keys(byRoot)) if (key !== root) void refresh(key);
  });
}

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
