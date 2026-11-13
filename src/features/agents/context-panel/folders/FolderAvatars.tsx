// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { Folder } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@/native/invoke";
import { agentAccountId } from "../../personal/agentAccount";

/**
 * The GitHub account behind each linked folder's `origin` remote (`project_git_owners`), for the
 * avatar on its row in the folder lists. Kept for the whole window, a folder with no GitHub owner
 * included, so rows mounting again don't read every repository again; rows mounting together
 * share one native call.
 */

/** Folder → owner login; null when it has none. */
const owners = new Map<string, string | null>();
const listeners = new Map<string, Set<() => void>>();
const pending = new Set<string>();
let queue: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function notify(path: string) {
  for (const listener of listeners.get(path) ?? []) listener();
}

function subscribe(path: string | undefined, onChange: () => void): () => void {
  if (!path) return () => {};
  let set = listeners.get(path);
  if (!set) {
    set = new Set();
    listeners.set(path, set);
  }
  set.add(onChange);
  return () => {
    set.delete(onChange);
    if (set.size === 0) listeners.delete(path);
  };
}

async function flushOwners() {
  flushTimer = null;
  const batch = queue;
  queue = [];
  if (!batch.length) return;
  for (const path of batch) pending.add(path);
  try {
    const rows = await invoke<{ path: string; login: string }[]>("project_git_owners", {
      account: agentAccountId(),
      folders: batch,
    });
    const byPath = new Map(rows.map((row) => [row.path, row.login]));
    for (const path of batch) {
      const login = byPath.get(path) ?? null;
      if (owners.get(path) === login) continue;
      owners.set(path, login);
      notify(path);
    }
  } catch {
    // A failed call isn't remembered as "no owner": the next row to mount asks again.
  } finally {
    for (const path of batch) pending.delete(path);
  }
}

function requestOwners(paths: Iterable<string>) {
  for (const path of paths) {
    if (!path || owners.has(path) || pending.has(path) || queue.includes(path)) continue;
    queue.push(path);
  }
  if (queue.length && flushTimer === null) flushTimer = setTimeout(() => void flushOwners(), 0);
}

/** The GitHub owner of a folder's `origin`, or null when it has none or isn't known yet. */
function useFolderOwner(path: string | undefined): string | null {
  const subscribePath = useCallback((onChange: () => void) => subscribe(path, onChange), [path]);
  const read = useCallback(() => (path ? (owners.get(path) ?? null) : null), [path]);
  const owner = useSyncExternalStore(subscribePath, read, read);
  useEffect(() => {
    if (path) requestOwners([path]);
  }, [path]);
  return owner;
}

/** GitHub's `<login>.png` serves the account's own avatar; twice the CSS size stays sharp. */
function githubAvatarUrl(login: string, cssSize: number): string {
  const size = Math.min(460, Math.max(1, Math.round(cssSize * 2)));
  return `https://github.com/${encodeURIComponent(login)}.png?size=${size}`;
}

/**
 * A folder row's leading tile: the owner's GitHub avatar when its `origin` is on GitHub, else the
 * folder icon, which also stays underneath while the image loads or when it can't.
 */
export function FolderAvatar({ path, size = 16 }: { path: string; size?: number }) {
  const owner = useFolderOwner(path);
  const src = owner ? githubAvatarUrl(owner, size) : null;
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <Folder className="size-full text-cream-muted" />
      {src && src !== failed ? (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(src)}
          className="absolute inset-0 size-full rounded-[4px] object-cover"
        />
      ) : null}
    </span>
  );
}
