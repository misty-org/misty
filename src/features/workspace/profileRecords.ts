import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { registerRecoveryFlush } from "@/features/workspace/recoveryStorage";
import { rendererRecords, type SharedRecord } from "@/features/workspace/profileRecordModel";
import { userBookmarkFolders } from "@/features/bookmarks/navigationDefaults";
import { currentProfile } from "./profileWindow";
import { SaveRetryBackoff } from "./saveRetryBackoff";
import { savedGroupRecords, savedGroupsFromRecords } from "./savedTabGroups";
import { useWorkspaceStore, type WorkspaceStore } from "./useWorkspaceStore";

/**
 * Bookmarks and saved tab groups belong to the profile, shared by all its windows. The native
 * side keeps them; the workspace store shows a copy. Changes are written after a short pause,
 * only the records that changed, and a change anywhere reloads every window of the profile.
 */
export type ProfileRecordCollection = "bookmarks" | "tab_groups";

const collections: ProfileRecordCollection[] = ["bookmarks", "tab_groups"];
const writeDelayMs = 400;

/** A collection's records this renderer shows; a kind it doesn't know is left out and alone. */
async function listProfileRecords(collection: ProfileRecordCollection) {
  return rendererRecords(await invoke<SharedRecord[]>("profile_records_list", { collection }));
}

/** Saves changes (`record: null` deletes) and returns the ids refused. */
function writeProfileRecords(
  collection: ProfileRecordCollection,
  writes: { id: string; record: SharedRecord | null }[],
) {
  return invoke<string[]>("profile_records_write", { collection, writes });
}

type RecordState = Pick<WorkspaceStore, "bookmarkFolders" | "bookmarks" | "tabGroups">;

/** A collection's records as the workspace store holds them now. */
export function localProfileRecords(
  collection: ProfileRecordCollection,
  state: RecordState,
): SharedRecord[] {
  return collection === "bookmarks"
    ? [...state.bookmarkFolders, ...state.bookmarks]
    : savedGroupRecords(state.tabGroups);
}

/** What a window holds that is the profile's now, for a profile with no records yet. */
export function recordSeed(state: RecordState): Record<ProfileRecordCollection, SharedRecord[]> {
  return {
    bookmarks: localProfileRecords("bookmarks", state),
    tab_groups: localProfileRecords("tab_groups", state),
  };
}

/** The store patch that shows a collection's records. */
function shownRecords(
  collection: ProfileRecordCollection,
  records: SharedRecord[],
  state: RecordState,
): Partial<RecordState> {
  if (collection === "tab_groups")
    return {
      tabGroups: [
        ...state.tabGroups.filter((group) => !group.savedTabs),
        ...savedGroupsFromRecords(records, state.tabGroups),
      ],
    };
  const folders = records.filter(
    (record): record is SharedRecord<"folder"> => record.kind === "folder",
  );
  const bookmarks = records.filter(
    (record): record is SharedRecord<"bookmark"> => record.kind === "bookmark",
  );
  return { bookmarkFolders: userBookmarkFolders(folders, bookmarks), bookmarks };
}

/** Field order isn't meaningful, and the native side stores fields sorted. */
function canonicalRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalRecord);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, item]) => [key, canonicalRecord(item)]),
  );
}

export const encodedRecords = (records: SharedRecord[]) =>
  new Map(records.map((record) => [record.id, JSON.stringify(canonicalRecord(record))]));

/** What differs between the last known native copy and the store. */
export function recordWrites(
  known: ReadonlyMap<string, string>,
  records: SharedRecord[],
): { id: string; record: SharedRecord | null }[] {
  const local = encodedRecords(records);
  const byId = new Map(records.map((record) => [record.id, record]));
  return [
    ...[...local]
      .filter(([id, text]) => known.get(id) !== text)
      .map(([id]) => ({ id, record: byId.get(id)! })),
    ...[...known.keys()].filter((id) => !local.has(id)).map((id) => ({ id, record: null })),
  ];
}

export interface ProfileRecordsHandle {
  stop(): void;
  /** Whether what this window opened with has reached the profile's records. */
  seeded(): boolean;
  /** Resolves once `seeded()` turns true. */
  whenSeeded: Promise<void>;
}

/**
 * Loads a profile's records and keeps the store and the native copy in step. `seed` holds what
 * this window opened with from before records were the profile's: a profile with no records of
 * a kind takes it as its own, once.
 */
export function startProfileRecords(
  seed: Partial<Record<ProfileRecordCollection, SharedRecord[]>> = {},
): ProfileRecordsHandle {
  const known = new Map<ProfileRecordCollection, Map<string, string>>();
  /** Refused records, so they aren't sent again until they change. */
  const refused = new Map<string, string>();
  let stopped = false;
  let queue: Promise<unknown> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let markSeeded = () => {};
  const whenSeeded = new Promise<void>((resolve) => {
    markSeeded = resolve;
  });
  let seededNow = false;

  const inOrder = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  const show = (collection: ProfileRecordCollection, records: SharedRecord[]) => {
    const state = useWorkspaceStore.getState();
    const before = recordWrites(encodedRecords(localProfileRecords(collection, state)), records);
    if (before.length) useWorkspaceStore.setState(shownRecords(collection, records, state));
  };

  const load = async (collection: ProfileRecordCollection) => {
    const listed = await listProfileRecords(collection);
    if (stopped) return;
    const seeding = !known.has(collection) && !listed.length ? seed[collection] : undefined;
    if (seeding?.length) {
      const rejected = new Set(
        await writeProfileRecords(
          collection,
          seeding.map((record) => ({ id: record.id, record })),
        ),
      );
      if (stopped) return;
      known.set(collection, encodedRecords(seeding.filter((record) => !rejected.has(record.id))));
      show(collection, seeding);
      return;
    }
    known.set(collection, encodedRecords(listed));
    show(collection, listed);
  };

  const noteSeeded = () => {
    if (seededNow || collections.some((collection) => !known.has(collection))) return;
    seededNow = true;
    markSeeded();
  };

  const write = async (collection: ProfileRecordCollection) => {
    const saved = known.get(collection);
    // Once stopped the store may hold another account's state: nothing more goes out.
    if (!saved || stopped) return;
    const records = localProfileRecords(collection, useWorkspaceStore.getState());
    const texts = encodedRecords(records);
    const writes = recordWrites(saved, records).filter(
      ({ id }) => !refused.has(id) || refused.get(id) !== texts.get(id),
    );
    if (!writes.length) return;
    const rejected = new Set(await writeProfileRecords(collection, writes));
    for (const { id, record } of writes) {
      if (rejected.has(id)) {
        refused.set(id, texts.get(id)!);
        continue;
      }
      refused.delete(id);
      if (record) saved.set(id, texts.get(id)!);
      else saved.delete(id);
    }
    if (rejected.size)
      window.dispatchEvent(
        new CustomEvent("misty:workspace-notice", {
          detail: "A bookmark or saved tab group couldn't be saved.",
        }),
      );
  };

  /** Loads what hasn't loaded and writes what changed. Failures stay here to try again. */
  const settle = () =>
    inOrder(async () => {
      if (stopped) return;
      let failed = 0;
      for (const collection of collections) {
        try {
          if (!known.has(collection)) await load(collection);
          await write(collection);
        } catch {
          failed += 1;
        }
      }
      noteSeeded();
      backoff.update(failed);
      if (failed) throw new Error("Profile records couldn't be saved.");
    });
  const backoff = new SaveRetryBackoff(settle);

  const reload = (collection: ProfileRecordCollection) =>
    inOrder(async () => {
      if (known.has(collection)) await write(collection);
      await load(collection);
      noteSeeded();
    }).catch(() => backoff.update(1));

  const unsubscribe = useWorkspaceStore.subscribe((state, previous) => {
    if (
      state.bookmarkFolders === previous.bookmarkFolders &&
      state.bookmarks === previous.bookmarks &&
      state.tabGroups === previous.tabGroups
    )
      return;
    clearTimeout(timer);
    timer = setTimeout(() => void settle().catch(() => undefined), writeDelayMs);
  });
  const unregister = registerRecoveryFlush(() => {
    clearTimeout(timer);
    // Best effort: a refused record must not hold up quitting or an account change.
    return settle().catch(() => undefined);
  });
  const stopListening = listen<{ profile: string; collection: string }>(
    "misty://profile-records-changed",
    ({ payload }) => {
      if (stopped || payload.profile !== currentProfile().id) return;
      if (collections.includes(payload.collection as ProfileRecordCollection))
        void reload(payload.collection as ProfileRecordCollection);
    },
  ).catch(() => undefined);
  void settle().catch(() => undefined);

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      backoff.dispose();
      unsubscribe();
      unregister();
      void stopListening.then((stop) => stop?.());
    },
    seeded: () => seededNow,
    whenSeeded,
  };
}
