import { notify } from "@misty/ui";
import * as Y from "yjs";
import { driveFileRef, driveHostError } from "../drive/drive_app_files";
import { driveEntryById, onDriveChanged, type DriveEntry } from "../drive/drive_native";
import { createYjsProvider, firstCollaborationTicket, requestCollaborationTicket } from "../journal/notes/create_yjs_provider";
import { providerRoom, type FileRoomOpener } from "./app_rooms";
import { keepAsks, pausedEdits, writeConflictedCopy } from "./app_file_room_copies";
import { holdSync, type FreezeMark } from "./app_file_room_hold";
import { frozenLeave } from "./app_file_room_leaving";
import { fileLoader } from "./app_file_room_loader";
import { savedReports } from "./app_file_room_reports";
import { FILE_META, fingerprintOf, metaWrite, sameBytes, snapshotOf } from "./app_file_room_marks";
import { LARGE_SAVE_NOTICE, PAUSED_MESSAGE, REFUSED_MESSAGE, outsideNotice, readFileRoomMessage } from "./app_file_room_messages";
import { contentFloor, renameFloor, renamesSince, settledOnServer } from "./app_file_room_renames";
import { WRITE_BOUND_MS, matchesSave, writeSave } from "./app_file_room_saves";
import { serverContents } from "./app_file_room_server_contents";
import type { FileFormat, FileHolds, FileTicket, PendingSave } from "./app_file_room_types";
import { HostError } from "./protocol";

export { FILE_META, FILE_TEXT, fingerprintOf, liveText, snapshotOf } from "./app_file_room_marks";

const SAVE_AFTER_MS = 1500;
const SAVE_MAX_WAIT_MS = 10_000;
const SERIALIZE_BOUND_MS = 60_000;
const RELOAD_BOUND_MS = 10_000;
const GENERATION_BOUND_MS = 10_000;
const OUTSIDE_BOUND_MS = 10_000;
const KEEP_BOUND_MS = 30_000;
const RESOLVE_KEEP_MS = 25_000;
const RESOLVE_ANSWER_MS = 20_000;
const FREEZE_BOUND_MS = 75_000;
const CLOSE_BOUND_MS = 30_000;
const OUTSIDE_WAIT_MS = 45_000;
const MAX_RESOLVE_ATTEMPTS = 2;
const RESEND_WAIT_MS = 5_000;

const FROM_HOST = Symbol("misty-file-room");

export type { FileFormat, FileHolds, FileRoomSession } from "./app_file_room_types";

export function fileRoomOpener(spaceId: string, appId: string, holds: FileHolds): FileRoomOpener {
  const ticket = (fileId: string, gc: boolean) =>
    requestCollaborationTicket<FileTicket>(
      `/spaces/${encodeURIComponent(spaceId)}/drive/items/${encodeURIComponent(fileId)}/collaboration-ticket`,
      gc ? { app_id: appId } : { app_id: appId, gc: false },
    );

  return async (fileId, { gc, signal }, emit, fail) => {
    const server = serverContents(spaceId, fileId);
    let found: DriveEntry | null;
    try {
      found = await driveEntryById(spaceId, fileId).then((at) => (at ? server.entry(at) : null));
    } catch (cause) {
      throw driveHostError(cause);
    }
    if (!found || found.kind !== "file")
      throw new HostError("not_found", "That file isn't in the Space's drive any more.");
    let entry: DriveEntry = found;
    const renameSince = renamesSince(found);
    const first = await firstCollaborationTicket(() => ticket(fileId, gc), signal);
    if (signal?.aborted) throw new HostError("cancelled", "The app left the room.");
    const format: FileFormat = first.format === "text" ? "text" : "app";
    const releaseHold = await holds.hold(entry).catch((cause: unknown) => {
      throw driveHostError(cause);
    });
    if (signal?.aborted) {
      releaseHold();
      throw new HostError("cancelled", "The app left the room.");
    }
    const doc = new Y.Doc({ gc });
    const opened = createYjsProvider(first, doc, "file-room", () => ticket(fileId, gc));
    const { provider } = opened;

    const hold = holdSync(provider, doc);

    const room = providerRoom(opened, doc);
    const meta = doc.getMap<unknown>(FILE_META);
    let serverWriter = false, writer = false, readOnly = false, warnedReadOnly = false, serverLoaded = false, serverDirty = false;
    let serverHasWriter: boolean | undefined, serverBase: number | undefined, ownBase: number | undefined;
    let refusedSaid = false, largeSaid = false;
    let generation: string | undefined;
    let dirty = false, unsent = false;
    let localEdits = 0;
    let behindDrive: number | undefined;
    let started = false, closed = false;
    let wasLoaded = false;
    let request = 0;
    let inFlight: { request: number; snapshot: Uint8Array; vector: Uint8Array; edits: number; answered: boolean } | null = null;
    let pendingSave: PendingSave | null = null;
    let again = false;
    let serializeTimer: ReturnType<typeof setTimeout> | undefined;
    let writing = false;
    let waitingDrive: DriveEntry | null = null;
    let outside = false, outsideSaid = false;
    let outsideTimer: ReturnType<typeof setTimeout> | undefined;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    let recheck: number | undefined;
    let keeping = false, keptName: string | null = null;
    let announced: { version: number; name: string; fingerprint: string } | null = null;
    let frozenOutside: FreezeMark | null = null;
    let resolving = false, resolveAttempts = 0;
    let pause: { version: number; accepted: boolean; sentOn: number; asks: number; at: number } | null = null;
    let pauseTimer: ReturnType<typeof setTimeout> | undefined;
    let pausedSaid: number | undefined;
    const paused = pausedEdits();
    let resolvedFor: { version: number; fingerprint: string; name: string; covers: number } | null = null;
    let keepingFor: number | undefined;
    let lastWritten: { version: number; size: number } | null = null;
    let ownWait: number | undefined, ownWaitTimer: ReturnType<typeof setTimeout> | undefined;
    let graceFor: number | undefined, graceTimer: ReturnType<typeof setTimeout> | undefined;
    let textOutside: number | undefined, waitTimer: ReturnType<typeof setTimeout> | undefined;
    let links = 0, confirmedLink = -1;
    let lingering = false, finished = false, lingerTimer: ReturnType<typeof setTimeout> | undefined;
    let copying = false, told = "";
    let timer: ReturnType<typeof setTimeout> | undefined, maxTimer: ReturnType<typeof setTimeout> | undefined;
    const stops: (() => void)[] = [];

    const loaded = () => meta.get("loaded") !== undefined;
    const linked = () => provider.wsconnected && provider.synced;
    const loadedFrom = () => {
      const from = meta.get("loaded");
      return typeof from === "number" ? from : 0;
    };
    const baseVersion = () => Math.max(ownBase ?? 0, serverBase ?? 0, loadedFrom());
    const frozen = frozenLeave({
      doc, hold, paused, linked, generation: () => generation, pause: () => pause, links: () => links,
      settle: () => settleClose(), finish: () => finishClose(),
    });
    const say = (message: object) => !readOnly && linked() && room.send?.(JSON.stringify(message)) === true;
    const rename = (version: number) => say({ type: "file_saved", renamed: version });
    const renames = renameFloor({ base: baseVersion, serverBase: () => serverBase, links: () => links, send: rename });
    const contents = contentFloor({ base: baseVersion, entry: () => entry, fallback: renames, links: () => links, say }), knownVersion = contents.known;
    const problem = (code: string, message: string) => {
      if (!closed) emit({ type: "problem", code, message });
    };
    const warnReadOnly = () => {
      if (warnedReadOnly) return;
      warnedReadOnly = true;
      problem("read_only", "You can see this file but not change it.");
    };
    const tell = () => {
      if (!started || closed) return;
      const state = {
        file: driveFileRef(entry),
        format,
        writer,
        loaded: loaded() || serverLoaded,
        editable: !readOnly,
        ...(serverHasWriter === undefined ? {} : { has_writer: serverHasWriter || writer }),
      };
      const key = JSON.stringify(state);
      if (key === told) return;
      told = key;
      emit({ type: "file", ...state });
    };
    const busy = () =>
      pendingSave !== null ||
      inFlight?.answered === true ||
      saves.busy ||
      copying ||
      frozen.holding;
    const finishClose = () => {
      if (finished) return;
      finished = true;
      lingering = false;
      clearTimeout(lingerTimer);
      lingerTimer = undefined;
      for (const stop of stops.splice(0)) stop();
      hold.stop();
      releaseHold();
      room.close();
    };
    const settleClose = () => {
      if (lingering && !busy()) finishClose();
    };
    const saves = savedReports({
      versioned: format === "app",
      send: (message) => room.send?.(message) === true,
      link: () => ({ links, confirmedLink, serverBase, serverDirty }),
      alive: () => !closed || lingering,
      settle: () => settleClose(),
    });
    const report = saves.report;
    const confirm = (pending: NonNullable<typeof pendingSave>, version: number) => {
      if (pendingSave === pending) pendingSave = null;
      ownBase = Math.max(ownBase ?? 0, version);
      lastWritten = { version, size: pending.size };
      renames.tell();
      if (localEdits === pending.edits) dirty = false;
      if (closed && !lingering) return;
      const clean = sameBytes(snapshotOf(doc), pending.snapshot);
      if (writer && !pause && meta.get("saved") !== version) doc.transact(() => meta.set("saved", version), FROM_HOST);
      if (clean) report(snapshotOf(doc), Y.encodeStateVector(doc), version);
      else report(pending.snapshot, pending.vector, version);
    };
    const canSave = () =>
      !closed &&
      started &&
      writer &&
      linked() &&
      format === "app" &&
      loaded() &&
      !outside &&
      !keeping &&
      !resolving &&
      pause === null &&
      graceTimer === undefined &&
      reloadTimer === undefined;
    const finish = () => {
      clearTimeout(serializeTimer);
      serializeTimer = undefined;
      inFlight = null;
      if (again) {
        again = false;
        soon();
      }
    };
    const askSerialize = () => {
      stopTimers();
      if (!canSave()) return;
      if (inFlight) {
        again = true;
        return;
      }
      request += 1;
      const asked = request;
      inFlight = {
        request: asked,
        snapshot: snapshotOf(doc),
        vector: Y.encodeStateVector(doc),
        edits: localEdits,
        answered: false,
      };
      serializeTimer = setTimeout(() => {
        if (inFlight?.request !== asked) return;
        problem("save_failed", "The app didn't hand over the file in time, so it wasn't saved.");
        finish();
      }, SERIALIZE_BOUND_MS);
      emit({ type: "serialize", request: asked });
    };
    const soon = () => {
      if (!canSave()) return;
      clearTimeout(timer);
      timer = setTimeout(askSerialize, SAVE_AFTER_MS);
      if (maxTimer === undefined) maxTimer = setTimeout(askSerialize, SAVE_MAX_WAIT_MS);
    };
    const setWriter = (next: boolean) => {
      if (writer === next) return;
      writer = next;
      if (writer) {
        loader.reset();
        return;
      }
      stopTimers();
      clearTimeout(serializeTimer);
      serializeTimer = undefined;
      inFlight = null;
      again = false;
    };
    const recompute = () => setWriter(serverWriter && linked() && !closed);
    const loader = fileLoader({
      spaceId,
      format,
      doc,
      meta,
      origin: FROM_HOST,
      entry: () => entry,
      wanted: () => !closed && writer && !loaded() && !serverLoaded,
      linked,
      closed: () => closed,
      emitLoad: (version, data) => {
        request += 1;
        emit({ type: "load", request, version, data });
      },
      fail,
      problem,
    });
    const takeTurn = () => {
      if (!writer || !started || closed || pause) return;
      if (!loaded() && !serverLoaded) {
        void loader.load();
        return;
      }
      if (format === "app" && loaded() && !outside && !pendingSave && !inFlight && !writing) {
        const version = entry.version ?? 0;
        if (version > knownVersion()) {
          changedOutside(version);
          return;
        }
      }
      if (dirty || serverDirty) soon();
    };
    const release = () => {
      if (format === "app" && writer && linked()) room.send?.(JSON.stringify({ type: "file_writer_release" }));
    };
    const sayOutside = () => {
      if (outsideSaid || !linked()) return;
      if (format === "app") {
        if (!writer) return;
        room.send?.(JSON.stringify({ type: "file_outside" }));
      } else {
        if (readOnly) return;
        room.send?.(JSON.stringify({ type: "file_outside", version: entry.version ?? 0 }));
      }
      outsideSaid = true;
    };
    const stopTimers = () => {
      clearTimeout(timer);
      timer = undefined;
      clearTimeout(maxTimer);
      maxTimer = undefined;
    };
    const declareOutside = (heard = false) => {
      clearTimeout(reloadTimer);
      reloadTimer = undefined;
      clearTimeout(graceTimer);
      graceTimer = undefined;
      clearTimeout(waitTimer);
      waitTimer = undefined;
      if (closed || outside) return;
      outside = true;
      unpause();
      resolving = false;
      if (heard) outsideSaid = true;
      recheck = undefined;
      stopTimers();
      problem("save_failed", outsideNotice(readOnly, keptName));
      sayOutside();
      release();
    };
    const keeps = keepAsks(
      (asked) => emit({ type: "serialize", request: asked }),
      () => (request += 1),
    );
    const roomBytes = async () =>
      format === "text" ? new TextEncoder().encode(paused.textWith(doc)) : await keeps.ask(KEEP_BOUND_MS);
    const keepCopy = async (): Promise<string | null> => {
      const data = await roomBytes();
      return data ? writeConflictedCopy(spaceId, entry, data, KEEP_BOUND_MS) : null;
    };
    const unpause = () => {
      clearTimeout(pauseTimer);
      pauseTimer = undefined;
      if (!pause) return;
      const { accepted, sentOn, asks } = pause;
      pause = null;
      resolving = false;
      keepingFor = undefined;
      if (closed || keeping) return;
      if (paused.lost) {
        reloaded("Edits were paused for longer than Misty could hold them. Open the file again to keep editing.", true);
        return;
      }
      paused.replay(doc);
      if (accepted) hold.resendAfterFreeze({ asks, link: sentOn }, links, RESEND_WAIT_MS);
    };
    const pauseFor = (version: number, accepted: boolean) => {
      if (outside && accepted && !frozenOutside) frozenOutside = { asks: hold.asks, link: links };
      if (closed || keeping || outside) return;
      if (pause?.accepted && (!accepted || pause.version === version)) {
        if (accepted) keepForResolve(version);
        return;
      }
      pause = { version, accepted, sentOn: links, asks: hold.asks, at: Date.now() };
      stopTimers();
      clearTimeout(pauseTimer);
      pauseTimer = setTimeout(
        () => {
          pauseTimer = undefined;
          if (!pause || closed) return;
          if (!pause.accepted) {
            unpause();
            return;
          }
          declareOutside();
        },
        accepted ? FREEZE_BOUND_MS : RESOLVE_ANSWER_MS,
      );
      if (!accepted) return;
      if (pausedSaid !== version) {
        pausedSaid = version;
        problem("stalled", PAUSED_MESSAGE);
      }
      keepForResolve(version);
    };
    const sendResolved = async (version: number) => {
      const done = resolvedFor;
      if (!done || done.version !== version) return;
      const current = await fingerprintOf(snapshotOf(doc));
      if (closed || keeping || !writer || pause?.version !== version || resolvedFor !== done) return;
      if (current !== done.fingerprint) {
        declareOutside();
        return;
      }
      room.send?.(
        JSON.stringify({ type: "file_reload", version, kept: true, fingerprint: done.fingerprint, kept_name: done.name }),
      );
    };
    const keepForResolve = (version: number) => {
      if (closed || keeping || format !== "app" || !writer || readOnly || !linked() || hold.active) return;
      if (!pause?.accepted || pause.version !== version) return;
      if (resolvedFor?.version === version) {
        void sendResolved(version);
        return;
      }
      if (keepingFor === version) return;
      keepingFor = version;
      resolving = true;
      const snapshot = snapshotOf(doc);
      const covers = paused.count;
      const offered = announced?.version === version ? announced : null;
      const asked = offered ? null : keeps.ask(RESOLVE_KEEP_MS);
      const fingerprinting = fingerprintOf(snapshot);
      fingerprinting.catch(() => undefined);
      void (async () => {
        const told = offered && offered.fingerprint === (await fingerprinting) ? offered : null;
        let name = told?.name ?? null;
        if (!told) {
          const data = await (asked ?? keeps.ask(RESOLVE_KEEP_MS));
          name = data ? await writeConflictedCopy(spaceId, entry, data, RESOLVE_KEEP_MS) : null;
          if (name && linked())
            room.send?.(JSON.stringify({ type: "file_kept", version, kept_name: name, fingerprint: await fingerprinting }));
        }
        if (name) keptName = name;
        if (keepingFor !== version) {
          if (name && !told && !closed && !keeping && !pause)
            notify({ message: `Your changes were also kept in ${name}.` });
          return;
        }
        keepingFor = undefined;
        if (closed || keeping || pause?.version !== version) return;
        if (!name) {
          declareOutside();
          return;
        }
        resolvedFor = { version, fingerprint: await fingerprinting, name, covers };
        await sendResolved(version);
      })().catch(() => {
        if (keepingFor !== version) return;
        keepingFor = undefined;
        declareOutside();
      });
    };
    const ownSave = (version: number) => {
      if ((entry.version ?? 0) !== version) return false;
      if (lastWritten?.version === version && lastWritten.size === entry.size) {
        ownBase = Math.max(ownBase ?? 0, version);
        return true;
      }
      const pending = pendingSave;
      if (!pending || entry.size !== pending.size || version <= pending.base) return false;
      if (!matchesSave(pending, entry)) return false;
      if (settledOnServer(entry.state)) {
        confirm(pending, version);
        return true;
      }
      if (ownWait === version) return false;
      ownWait = version;
      clearTimeout(ownWaitTimer);
      ownWaitTimer = setTimeout(() => {
        ownWaitTimer = undefined;
        if (!closed && version > knownVersion()) outsideFound(version);
      }, WRITE_BOUND_MS);
      return true;
    };
    const resolveOutside = (version: number) => {
      if (closed || outside || resolving || keeping || pause) return;
      if (!writer || readOnly || !linked() || resolveAttempts >= MAX_RESOLVE_ATTEMPTS) {
        declareOutside();
        return;
      }
      if (format === "app" && ownSave(version)) return;
      resolveAttempts += 1;
      resolving = true;
      stopTimers();
      pauseFor(version, false);
      if (room.send?.(JSON.stringify({ type: "file_resolve", version }))) return;
      unpause();
      recheck = Math.max(recheck ?? 0, version);
    };
    const outsideFound = (version: number) => {
      if (closed || outside || resolving || keeping || pause) return;
      if (writer && !readOnly) {
        resolveOutside(version);
        return;
      }
      if (format === "text" && !readOnly && linked() && !outsideSaid) {
        room.send?.(JSON.stringify({ type: "file_outside", version }));
        outsideSaid = true;
        return;
      }
      declareOutside();
    };
    const conflicted = (version: number) => {
      if (version > knownVersion()) outsideFound(version);
      else declareOutside();
    };
    const changedOutside = (seen: number) => {
      if (closed || outside || keeping || resolving || pause || graceTimer !== undefined || reloadTimer !== undefined)
        return;
      const version = renames.content(seen);
      if (!linked()) {
        recheck = Math.max(recheck ?? 0, version);
        return;
      }
      const clean = !dirty && !serverDirty && !pendingSave && !inFlight && loaded();
      if (clean) {
        stopTimers();
        reloadTimer = setTimeout(() => {
          reloadTimer = undefined;
          if (closed || version <= knownVersion() || (format === "app" && !writer)) return;
          outsideFound(version);
        }, RELOAD_BOUND_MS);
        if ((writer || (format === "text" && !readOnly)) && linked())
          room.send?.(JSON.stringify({ type: "file_reload", version }));
        return;
      }
      if (format === "app" && graceFor !== version) {
        graceFor = version;
        stopTimers();
        graceTimer = setTimeout(() => {
          graceTimer = undefined;
          if (closed) return;
          if (version > knownVersion()) changedOutside(version);
          else {
            graceFor = undefined;
            takeTurn();
          }
        }, OUTSIDE_BOUND_MS);
        return;
      }
      outsideFound(version);
    };
    const judgeTextOutside = () => {
      const version = textOutside;
      if (version === undefined || closed || outside || resolving || keeping || pause || hold.active || !linked()) return;
      textOutside = undefined;
      if (!dirty && !serverDirty && loaded()) {
        changedOutside(version);
        return;
      }
      if (writer && !readOnly) {
        clearTimeout(waitTimer);
        waitTimer = undefined;
        resolveOutside(version);
        return;
      }
      if (serverHasWriter !== true) {
        declareOutside(true);
        return;
      }
      if (waitTimer === undefined)
        waitTimer = setTimeout(() => {
          waitTimer = undefined;
          declareOutside(true);
        }, OUTSIDE_WAIT_MS);
    };
    const recheckOutside = () => {
      if (recheck === undefined || closed || outside || pause || hold.active || !linked()) return;
      if (format === "app" && !writer) return;
      const version = recheck;
      recheck = undefined;
      if (version > knownVersion()) changedOutside(version);
    };
    const watchTextVersion = (version: number) => {
      if (outsideTimer !== undefined) return;
      outsideTimer = setTimeout(() => {
        outsideTimer = undefined;
        if (closed || outside || readOnly || !loaded()) return;
        if (version > knownVersion()) changedOutside(version);
        else if ((entry.version ?? 0) > knownVersion()) watchTextVersion(entry.version ?? 0);
      }, OUTSIDE_BOUND_MS);
    };
    const gone = () => {
      if (closed) return;
      fail(new HostError("not_found", "That file isn't in the Space's drive any more."));
    };
    const endReloaded = (message: string) => {
      if (closed) return;
      hold.release(false);
      paused.clear();
      problem("reloaded", message);
      fail(new HostError("closed", "This file was opened afresh. Open it again to keep editing."));
    };
    const reloaded = (message: string, keep = false, covered?: string, keptAs?: string) => {
      if (closed || keeping) return;
      const name = keptAs ?? keptName;
      const said = name ? `Your changes were kept in ${name}; the file now shows the newer version.` : message;
      clearTimeout(pauseTimer);
      pauseTimer = undefined;
      pause = null;
      keepingFor = undefined;
      if (!keep || !(loaded() || wasLoaded) || !(dirty || unsent || paused.count > 0)) {
        endReloaded(said);
        return;
      }
      if (readOnly) {
        endReloaded(`${said} Your unsaved changes couldn't be kept because you can't edit this file.`);
        return;
      }
      keeping = true;
      resolving = false;
      hold.start();
      stopTimers();
      provider.disconnect();
      const covers = format === "app" && resolvedFor && keptAs === resolvedFor.name ? resolvedFor.covers : 0;
      void (async () => {
        const same =
          covered !== undefined && !paused.lost && paused.count <= covers && (await fingerprintOf(snapshotOf(doc))) === covered;
        if (same) {
          endReloaded(said);
          return;
        }
        const kept = await keepCopy();
        endReloaded(
          kept ? `${said} Your unsaved changes were kept in ${kept}.` : `${said} Your unsaved changes couldn't be kept.`,
        );
      })().catch(() => endReloaded(`${said} Your unsaved changes couldn't be kept.`));
    };
    const resendFrozen = () => {
      if (frozenOutside) hold.resendAfterFreeze(frozenOutside, links, RESEND_WAIT_MS);
      frozenOutside = null;
    };
    const onTransaction = (transaction: Y.Transaction) => {
      if (closed || transaction.changed.size === 0) return;
      const nowLoaded = loaded();
      if (nowLoaded && !wasLoaded) {
        wasLoaded = true;
        loader.clear();
        const loadedAt = loader.loadedAt;
        if (loadedAt !== undefined && writer && meta.get("loaded") === loadedAt) {
          ownBase = Math.max(ownBase ?? 0, loadedAt);
          report(snapshotOf(doc), Y.encodeStateVector(doc), loadedAt);
        }
        tell();
        return;
      }
      if (!nowLoaded || transaction.origin === FROM_HOST) return;
      if (![...transaction.changed.keys()].some((type) => type !== (meta as unknown))) return;
      if (transaction.origin !== provider) {
        localEdits += 1;
        dirty = true;
        if (!linked()) unsent = true;
      }
      soon();
    };
    doc.on("afterTransaction", onTransaction);
    stops.push(() => doc.off("afterTransaction", onTransaction));
    const onClose = () => {
      if (generation !== undefined) hold.start();
      serverWriter = false;
      recompute();
      tell();
    };
    const onStatus = ({ status }: { status: string }) => {
      if (status === "connected") links += 1;
      if (status !== "connected") return;
      hold.arm(GENERATION_BOUND_MS, () => {
        if (!closed) reloaded("This file's live room couldn't be rejoined safely. Open it again to keep editing.", true);
      });
    };
    const onSync = (done: boolean) => {
      recompute();
      tell();
      if (!done) return;
      if (!hold.active) unsent = paused.count > 0;
      if (pause?.accepted) keepForResolve(pause.version);
      contents.tell();
      takeTurn();
      recheckOutside();
      judgeTextOutside();
    };
    provider.on("connection-close", onClose);
    provider.on("status", onStatus);
    provider.on("sync", onSync);
    stops.push(() => {
      provider.off("connection-close", onClose);
      provider.off("status", onStatus);
      provider.off("sync", onSync);
    });
    if (room.onMessage)
      stops.push(
        room.onMessage((message) => {
          const said = readFileRoomMessage(message);
          if (!said) return;
          const { base } = said;
          if (closed) {
            frozen.heard(said);
            if (!lingering || said.type !== "file_writer") return;
            if (said.generation !== undefined && said.generation !== generation) {
              finishClose();
              return;
            }
            confirmedLink = links;
            if (base !== undefined) serverBase = base;
            serverDirty = said.dirty === true;
            saves.send();
            settleClose();
            return;
          }
          if (keeping) return;
          if (said.type === "writer_check") {
            if (said.nonce !== undefined && linked()) room.send?.(JSON.stringify({ type: "writer_ok", nonce: said.nonce }));
            return;
          }
          if (said.type === "file_outside") {
            resendFrozen();
            declareOutside(true);
            return;
          }
          if (said.type === "file_resolving") {
            if (said.version !== undefined && !hold.active) pauseFor(said.version, true);
            return;
          }
          if (said.type === "file_resolve_declined") {
            if (pause && !pause.accepted) unpause();
            return;
          }
          if (said.type !== "file_writer") return;
          if (said.generation !== undefined) {
            if (generation !== undefined && said.generation !== generation) {
              reloaded(
                "This file was opened afresh on the server. Open it again to see it.",
                true,
                said.fingerprint,
                said.keptName,
              );
              return;
            }
            generation = said.generation;
          }
          confirmedLink = links;
          if (hold.active) {
            hold.release(true);
            unsent = paused.count > 0;
          }
          readOnly = said.readOnly;
          if (said.hasWriter !== undefined) serverHasWriter = said.hasWriter;
          if (said.loaded !== undefined) serverLoaded = said.loaded;
          serverDirty = said.dirty === true;
          if (said.dirty === false && linked() && !pause) dirty = false;
          if (base !== undefined) serverBase = base;
          if (said.renamed !== undefined) renames.heard(said.renamed);
          serverWriter = said.writer;
          recompute();
          if (readOnly) warnReadOnly();
          tell();
          saves.send();
          renames.tell();
          contents.tell();
          if (graceTimer !== undefined && graceFor !== undefined && knownVersion() >= graceFor) {
            clearTimeout(graceTimer);
            graceTimer = undefined;
            graceFor = undefined;
          }
          if (format === "text" && said.outside && !outside)
            textOutside = Math.max(textOutside ?? 0, said.driveVersion ?? 0, entry.version ?? 0, 1);
          if (said.resolving !== undefined) {
            if (said.keptName && said.keptFingerprint)
              announced = { version: said.resolving, name: said.keptName, fingerprint: said.keptFingerprint };
            pauseFor(said.resolving, true);
          } else {
            resendFrozen();
            if (pause && (pause.accepted || pause.sentOn !== links)) unpause();
          }
          if (outside) {
            sayOutside();
            if (writer) {
              release();
              return;
            }
          }
          takeTurn();
          recheckOutside();
          judgeTextOutside();
        }),
      );

    const judgeDrive = (next: DriveEntry) => {
      if ((closed && !lingering) || format !== "app" || !loaded()) return;
      if (writing || inFlight?.answered === true) {
        waitingDrive = next;
        return;
      }
      const version = next.version ?? 0;
      if (behindDrive !== undefined && version >= behindDrive && settledOnServer(next.state)) {
        behindDrive = undefined;
        soon();
      }
      const pending = pendingSave;
      if (pending && next.state === "conflict") {
        pendingSave = null;
        conflicted(version);
      } else if (pending && version > pending.base && version !== pending.version && (renames.from(version) !== undefined
        || contents.same(next, pending.base))) {
        const under = renames.from(version);
        if (!settledOnServer(next.state)) return;
        if (pending.version === undefined) {
          if (next.size === pending.size && matchesSave(pending, next)) confirm(pending, version);
        } else if (under === pending.version || contents.same(next, pending.base)) confirm(pending, pending.version);
      } else if (pending && version > pending.base) {
        if (!settledOnServer(next.state)) return;
        if (next.size === pending.size && matchesSave(pending, next)) confirm(pending, version);
        else {
          pendingSave = null;
          outsideFound(version);
        }
      } else if (!pending && writer && !outside && version > knownVersion()) {
        changedOutside(version);
      }
      settleClose();
    };
    const judgeWaitingDrive = () => {
      const next = waitingDrive;
      waitingDrive = null;
      if (!next || (closed && !lingering) || writing) return;
      const ahead = (next.version ?? 0) - (entry.version ?? 0);
      if (ahead > 0 || (ahead === 0 && next.mtime_ms > entry.mtime_ms)) entry = next;
      judgeDrive(next);
    };

    stops.push(
      onDriveChanged(server.events((changed) => {
        if ((closed && !lingering) || changed.space_id !== spaceId) return;
        if ((changed.removed ?? []).includes(entry.id)) {
          gone();
          return;
        }
        const next = changed.items.find((item) => item.id === entry.id);
        if (!next) return;
        if (next.removed || next.trashed) {
          gone();
          return;
        }
        const renamed = renameSince(next);
        entry = next;
        const version = next.version ?? 0;
        if (!contents.note(next) && renamed && renamed.to !== pendingSave?.version) renames.note(renamed);
        judgeDrive(next);
        if (
          !closed &&
          format === "text" &&
          generation !== undefined &&
          loaded() &&
          !outside &&
          !readOnly &&
          version > knownVersion()
        )
          watchTextVersion(version);
        tell();
      })),
    );

    const stillSaving = (answered: number) =>
      !closed &&
      writer &&
      linked() &&
      !outside &&
      !keeping &&
      pause === null &&
      reloadTimer === undefined &&
      inFlight?.request === answered;
    const write = (answered: number, data: Uint8Array) =>
      writeSave(
        { spaceId, entry: () => entry, base: baseVersion, known: knownVersion, still: () => stillSaving(answered), writing: (busy) => (writing = busy) },
        data,
      );

    return {
      room,
      started() {
        if (started || closed) return;
        started = true;
        wasLoaded = loaded();
        tell();
        takeTurn();
      },
      admit(update) {
        if (closed) return false;
        if (readOnly) {
          warnReadOnly();
          return false;
        }
        const written = metaWrite(doc, meta, update);
        if (written?.touches || (written?.loads && format === "text")) {
          if (!refusedSaid) problem("stalled", REFUSED_MESSAGE);
          refusedSaid = true;
          return false;
        }
        if (written?.loads && !(writer && loader.inFlight && !loaded() && written.loadedTo === loader.loadedAt)) {
          reloaded("This file was loaded in two places at once, so it was opened afresh. Open it again to see it.");
          return false;
        }
        if (!pause) return true;
        paused.push(update);
        localEdits += 1;
        dirty = true;
        unsent = true;
        return false;
      },
      async serialized(answered, data) {
        if (keeps.answer(answered, data)) return;
        if (inFlight?.request !== answered || inFlight.answered) return;
        inFlight.answered = true;
        const { snapshot, vector, edits } = inFlight;
        clearTimeout(serializeTimer);
        serializeTimer = undefined;
        try {
          const wrote = await write(answered, data);
          if (!wrote || (closed && !lingering)) return;
          const { written, base, sha } = wrote;
          entry = written;
          const version = written.version ?? 0;
          if (written.state === "conflict") {
            conflicted(version);
            return;
          }
          const settled = settledOnServer(written.state);
          if (written.state === "not_synced" && !largeSaid) {
            largeSaid = true;
            problem("save_failed", LARGE_SAVE_NOTICE);
          }
          if (settled && version < base) {
            behindDrive = base;
            return;
          }
          const pending: PendingSave = {
            base: Math.max(base, version),
            snapshot,
            vector,
            edits,
            size: data.byteLength,
            mtime: written.mtime_ms,
            sha,
            ...(settled ? { version } : {}),
          };
          pendingSave = pending;
          if (settled) confirm(pending, Math.max(base, version));
          tell();
        } catch (cause) {
          if (!closed)
            problem("save_failed", `The file couldn't be saved. ${driveHostError(cause).message}`);
        } finally {
          if (inFlight?.request === answered) finish();
          judgeWaitingDrive();
          settleClose();
        }
      },
      serializeFailed(answered, message) {
        if (keeps.answer(answered, null)) return;
        if (inFlight?.request !== answered || inFlight.answered) return;
        problem("save_failed", `The app couldn't write the file. ${message}`);
        finish();
      },
      close() {
        if (closed) return;
        closed = true;
        stopTimers();
        clearTimeout(serializeTimer);
        hold.stop();
        for (const left of [outsideTimer, reloadTimer, graceTimer, waitTimer, pauseTimer, ownWaitTimer]) clearTimeout(left);
        loader.clear();
        keeps.cancel();
        const held = format === "app" && !readOnly && !keeping && frozen.hold();
        if (format === "text" && unsent && !readOnly && !keeping && (loaded() || wasLoaded)) {
          copying = true;
          void keepCopy().finally(() => {
            copying = false;
            settleClose();
          });
        }
        if (!busy()) {
          finishClose();
          return;
        }
        lingering = true;
        lingerTimer = setTimeout(frozen.over, held ? Math.max(0, FREEZE_BOUND_MS - (Date.now() - (pause?.at ?? Date.now()))) : CLOSE_BOUND_MS);
      },
    };
  };
}
