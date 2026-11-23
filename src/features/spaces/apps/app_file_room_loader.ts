import type * as Y from "yjs";
import { driveHostError } from "../drive/drive_app_files";
import { driveEntryById, driveNative, type DriveEntry } from "../drive/drive_native";
import { FILE_TEXT, liveText } from "./app_file_room_marks";
import { HostError } from "./protocol";

const LOAD_BOUND_MS = 120_000;
const MAX_LOAD_ATTEMPTS = 2;

export interface FileLoaderDeps {
  spaceId: string;
  format: "text" | "app";
  doc: Y.Doc;
  meta: Y.Map<unknown>;
  origin: unknown;
  entry(): DriveEntry;
  wanted(): boolean;
  linked(): boolean;
  closed(): boolean;
  emitLoad(version: number, data: ArrayBuffer): void;
  fail(error: HostError): void;
  problem(code: string, message: string): void;
}

export interface FileLoader {
  readonly inFlight: boolean;
  readonly loadedAt: number | undefined;
  load(): Promise<void>;
  clear(): void;
  reset(): void;
}

export function fileLoader(deps: FileLoaderDeps): FileLoader {
  let inFlight = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loadedAt: number | undefined;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
    inFlight = false;
  };
  const timedOut = () => {
    timer = undefined;
    inFlight = false;
    if (!deps.wanted()) return;
    const retrying = attempts < MAX_LOAD_ATTEMPTS;
    deps.problem(
      "stalled",
      retrying
        ? "This file couldn't be loaded into the app yet, so Misty is trying once more."
        : "This file couldn't be loaded into the app. Close it and open it again.",
    );
    if (retrying) void load();
  };
  const load = async () => {
    if (inFlight || !deps.wanted() || attempts >= MAX_LOAD_ATTEMPTS) return;
    inFlight = true;
    attempts += 1;
    timer = setTimeout(timedOut, LOAD_BOUND_MS);
    let emitted = false;
    try {
      const fresh = (await driveEntryById(deps.spaceId, deps.entry().id)) ?? deps.entry();
      const data = await driveNative.read(deps.spaceId, fresh.path);
      if (!deps.wanted() || !deps.linked()) return;
      const version = fresh.version ?? 0;
      loadedAt = version;
      if (deps.format === "app") {
        emitted = true;
        deps.emitLoad(version, data);
        return;
      }
      const text = liveText(data);
      if (text === null) {
        deps.fail(
          new HostError(
            "unsupported",
            "This file can't be edited live: it has a byte order mark, Windows line endings or bytes that aren't UTF-8.",
          ),
        );
        return;
      }
      deps.doc.transact(() => {
        deps.doc.getText(FILE_TEXT).insert(0, text);
        deps.meta.set("loaded", version);
      }, deps.origin);
    } catch (cause) {
      if (!deps.closed()) deps.fail(driveHostError(cause));
    } finally {
      if (!emitted) clear();
    }
  };
  return {
    get inFlight() {
      return inFlight;
    },
    get loadedAt() {
      return loadedAt;
    },
    load,
    clear,
    reset() {
      attempts = 0;
    },
  };
}
