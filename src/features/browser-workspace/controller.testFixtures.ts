import { dockLeaves } from "@/features/workspace/dockTree";
import { vi } from "vitest";
import { WorkspaceSyncController, type WorkspaceSource } from "./controller";
import { EditJournal, type JournalStorage } from "./editJournal";
import type { SharedRecord, WorkspaceChange } from "./model";
import type { NativeSyncView } from "./native";
import { projectWorkspace } from "./projection";

function native(): NativeSyncView {
  return {
    session_id: "session:a",
    deployment: "https://misty.test",
    account_id: "account:a",
    vault_id: "workspace:a",
    device_id: "device:a",
    profile_id: "a".repeat(64),
    status: {
      phase: "catching_up",
      applied_sequence: 3,
      head_sequence: 3,
      pending_changes: 0,
      issue: null,
    },
    presence: [],
    pending_operation_ids: [],
    workspace: {
      active_device: { device_id: "device:a", epoch: "epoch:a", sequence: 1 },
      version: 1,
      sequence: 3,
      resumes: {},
      orphaned_view_ids: [],
      orphaned_bookmark_ids: [],
      records: [
        { kind: "window", id: "window:a", fields: { title: "Work", order: 0 } },
        {
          kind: "tab",
          id: "layout:a",
          fields: {
            window_id: "window:a",
            title: "",
            order: 0,
            tree: { type: "leaf", id: "pane:a" },
          },
        },
        {
          kind: "view",
          id: "tab:a",
          fields: {
            surface: "browser",
            title: "Page",
            placement: { tab_id: "layout:a", pane_id: "pane:a", order: 0 },
            url: "https://example.test",
            profile_id: "a".repeat(64),
            bookmark_id: null,
            tool_route: null,
            agent_owned: false,
          },
        },
      ],
    },
  };
}
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
// Flush only promise work; no timers, network, or implementation-specific sleeps.
async function settled() {
  for (let i = 0; i < 25; i++) await Promise.resolve();
}
function harness(disk: JournalStorage = storage()) {
  let current: NativeSyncView | null = native();
  let visible = projectWorkspace(current.workspace, {
    activeTabByWindow: {},
    activeViewByPane: {},
    focusedPaneByTab: {},
  });
  const listeners = new Set<() => void>();
  const source: WorkspaceSource = {
    read: () => ({
      windows: visible.windows,
      activeWindowId: visible.activeWindowId ?? "",
      folders: visible.folders,
      bookmarks: visible.bookmarks,
    }),
    write: vi.fn((next) => {
      visible = next;
      for (const listener of listeners) listener();
    }),
    subscribe: (changed) => {
      listeners.add(changed);
      return () => listeners.delete(changed);
    },
  };
  const journal = new EditJournal(disk, current);
  const applied = new Set<string>();
  const accept = (id: string, changes: WorkspaceChange[]) => {
    if (applied.has(id)) return id;
    applied.add(id);
    for (const change of changes) {
      const records = current!.workspace.records;
      const index = records.findIndex(
        (record) => record.kind === change.kind && record.id === change.id,
      );
      if (change.action === "delete") records.splice(index, 1);
      else if (change.action === "create")
        records.push({ kind: change.kind, id: change.id, fields: change.fields } as SharedRecord);
      else
        records[index] = {
          ...records[index],
          fields: { ...records[index].fields, ...change.fields },
        } as SharedRecord;
    }
    current!.workspace.sequence++;
    return id;
  };
  const ports = {
    source,
    journal,
    read: vi.fn(async () => structuredClone(current)),
    publish: vi.fn(async (_session: string, id: string, changes: WorkspaceChange[]) =>
      accept(id, changes),
    ),
    state: vi.fn(),
    error: vi.fn(),
    locked: vi.fn(),
    closed: vi.fn(),
  };
  const editTitle = (title: string) => {
    const next = structuredClone(visible);
    dockLeaves(next.windows[0].layout.tabs![0].root)[0].views[0].title = title;
    source.write(next);
  };
  return {
    ports,
    journal,
    accept,
    applied,
    editTitle,
    start: () => new WorkspaceSyncController(structuredClone(current!), ports),
    title: () => dockLeaves(visible.windows[0].layout.tabs![0].root)[0].views[0].title,
    current: () => current!,
    unlock: (view: NativeSyncView) => {
      current = view;
    },
    lock: () => {
      current = null;
    },
  };
}

export { deferred, harness, native, settled, storage };
