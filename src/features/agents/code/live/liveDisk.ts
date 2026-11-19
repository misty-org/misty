import { getCurrentWebview } from "@tauri-apps/api/webview";
import * as Y from "yjs";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { agentEditing } from "./liveAgents";
import { FILE_CHANGED_EVENT, liveApi } from "./liveApi";
import { seedAs, transactAs, type LiveRoom } from "./liveRoom";
import { outsideEdits } from "./liveText";
import type { FileChangedEvent, LiveJoin, StepAuthor } from "./liveTypes";

/**
 * The session's files in this person's worktree. The shared text is written there shortly after
 * it changes, so their terminal, formatters and agents see everyone's work; edits made there
 * (the watcher reports them, or a write finds one first) come back into the shared text as the
 * agent at work in the folder, or else as the person. A file joins the session the first time
 * someone opens or edits it, seeded with its text at the base commit.
 */

const writeDelayMs = 250;

export interface DiskMirror {
  /** A file's shared text, seeded from the base commit the first time it's needed. */
  ensureText(path: string): Promise<Y.Text>;
  stop(): Promise<void>;
}

export function startDiskMirror(room: LiveRoom, join: LiveJoin): DiskMirror {
  const seeds = new Map<string, Promise<Y.Text>>();
  const timers = new Map<string, number>();
  /** One write or outside edit at a time per file, in order. */
  const queues = new Map<string, Promise<void>>();
  /** Each file as Misty last wrote or read it on disk: what an outside edit is measured from. */
  const onDisk = new Map<string, string>();
  const refused = new Set<string>();
  let stopped = false;

  const queue = (path: string, work: () => Promise<void>) => {
    const next = (queues.get(path) ?? Promise.resolve()).then(work).catch(() => undefined);
    queues.set(path, next);
    return next;
  };

  function ensureText(path: string): Promise<Y.Text> {
    const have = room.files.get(path);
    if (have) return Promise.resolve(have);
    let pending = seeds.get(path);
    if (!pending) {
      pending = room.ready
        .then(async (): Promise<Y.Text> => {
          const present = room.files.get(path);
          if (present) return present;
          const base = await liveApi.baseFile(join.folder, join.baseCommit, path);
          // Seeded in one transaction. Two members seeding at once is settled by the map: one
          // text wins everywhere, and whoever lost reads the winner from the map again.
          if (!room.files.has(path))
            seedAs(room, () => room.files.set(path, new Y.Text(base ?? "")));
          return room.files.get(path)!;
        })
        .finally(() => seeds.delete(path));
      seeds.set(path, pending);
    }
    return pending;
  }

  const schedule = (path: string) => {
    if (stopped || refused.has(path)) return;
    window.clearTimeout(timers.get(path));
    timers.set(
      path,
      window.setTimeout(() => {
        timers.delete(path);
        void queue(path, () => write(path));
      }, writeDelayMs),
    );
  };

  async function write(path: string) {
    const text = room.files.get(path);
    if (!text || stopped) return;
    const content = text.toString();
    const outside = await liveApi.write(join.folder, path, content);
    if (outside === null) {
      onDisk.set(path, content);
      return;
    }
    // Someone changed the file on disk since Misty last knew it: take that in, then write.
    await takeIn(path, outside);
    schedule(path);
  }

  async function takeIn(path: string, outside: string) {
    let text: Y.Text;
    try {
      text = await ensureText(path);
    } catch {
      // Not text (binary or too large): it stays out of the session.
      refused.add(path);
      return;
    }
    const base = onDisk.get(path) ?? text.toString();
    onDisk.set(path, outside);
    if (outside === base) return;
    const agent = await agentEditing(join.folder, path);
    const author: StepAuthor = agent
      ? {
          kind: "agent",
          id: agent.id,
          name: agent.name,
          ownerId: room.me.id,
          ownerName: room.me.name,
        }
      : room.me;
    // Worked out against the text as it is now, inside the transaction, so an edit another
    // member made a moment ago is carried over rather than undone.
    transactAs(room, author, "disk", () => {
      for (const edit of outsideEdits(text.toString(), base, outside)) {
        if (edit.to > edit.from) text.delete(edit.from, edit.to - edit.from);
        if (edit.insert) text.insert(edit.from, edit.insert);
      }
    });
  }

  const onChange = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>) => {
    for (const event of events) {
      if (event.target === room.files) {
        for (const key of (event as Y.YMapEvent<Y.Text>).keysChanged) schedule(key);
        continue;
      }
      const path = event.path[0];
      if (typeof path === "string") schedule(path);
    }
  };

  let unlisten: (() => void) | null = null;
  const listening =
    hasTauriInternals() &&
    getCurrentWebview()
      .listen<FileChangedEvent>(FILE_CHANGED_EVENT, ({ payload }) => {
        if (stopped || payload.folder !== join.folder) return;
        void queue(payload.path, async () => {
          // A file removed outside comes back: the shared text is the truth.
          if (payload.text === null) schedule(payload.path);
          else await takeIn(payload.path, payload.text);
        });
      })
      .then((stop) => {
        unlisten = stop;
      });

  const started = room.ready.then(async () => {
    if (stopped) return;
    room.files.observeDeep(onChange);
    // The worktree takes the shared text first, so the watcher's starting point is the session.
    const paths = [...room.files.keys()];
    await Promise.all(paths.map((path) => queue(path, () => write(path))));
    if (!stopped) await liveApi.watch(join.folder, paths);
  });

  return {
    ensureText,
    async stop() {
      stopped = true;
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
      room.files.unobserveDeep(onChange);
      await started.catch(() => undefined);
      await Promise.all(queues.values());
      await listening;
      unlisten?.();
      await liveApi.unwatch(join.folder).catch(() => undefined);
    },
  };
}
