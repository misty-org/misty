import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useMemo, useState } from "react";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import { noAddon, type EditorAddon, type EditorAddonContext } from "../editorAddons";
import { liveEditorExtensions } from "./liveEditor";
import { runningSession } from "./liveSession";
import { joinHolding, useLiveStore } from "./liveStore";
import { authorKey } from "./liveTypes";

/** Until the shared text is there (or once the session closed), the editor can't be typed in. */
const locked: readonly Extension[] = [EditorState.readOnly.of(true), EditorView.editable.of(false)];

/** A text's identity, so the editor starts over when another member's seed replaced it. */
const textKey = (text: Y.Text) => {
  const id = text._item?.id;
  return id ? `${id.client}.${id.clock}` : "new";
};

type Bound = { path: string; text: Y.Text } | { path: string; refused: true } | null;

/**
 * Binds an editor on the Code page to the session's shared text when its file is in the
 * worktree this window joined: `yCollab` with an undo manager of the person's own edits, the
 * editor starting from the shared text, and the session writing the file itself.
 */
export function useLiveAddon(ctx: EditorAddonContext): EditorAddon {
  const join = useLiveStore((state) =>
    ctx.appearance === "page" ? joinHolding(state.joins, ctx.path) : null,
  );
  const roomState = useLiveStore((state) => (join ? state.rooms[join.sessionId] : undefined));
  const relative = join ? ctx.path.slice(join.folder.replace(/\/+$/, "").length + 1) : "";
  const running = join && roomState === "ready" ? runningSession(join.sessionId) : undefined;
  const [bound, setBound] = useState<Bound>(null);

  useEffect(() => {
    if (!running || !relative) return;
    let live = true;
    const read = () =>
      running.mirror.ensureText(relative).then(
        (text) => live && setBound({ path: relative, text }),
        () => live && setBound({ path: relative, refused: true }),
      );
    void read();
    // A member whose seed lost the race reads the winning text.
    const onFiles = (event: Y.YMapEvent<Y.Text>) => {
      if (event.keysChanged.has(relative)) void read();
    };
    running.room.files.observe(onFiles);
    return () => {
      live = false;
      running.room.files.unobserve(onFiles);
    };
  }, [running, relative]);

  const text = bound && bound.path === relative && "text" in bound ? bound.text : null;
  const refused = Boolean(bound && bound.path === relative && "refused" in bound);
  // Only edits made in this editor are tracked (y-codemirror adds its own origin), so ⌘Z never
  // undoes another member's, an agent's, or the disk's.
  const undoManager = useMemo(
    () => (text ? new Y.UndoManager(text, { trackedOrigins: new Set() }) : null),
    [text],
  );
  useEffect(() => () => undoManager?.destroy(), [undoManager]);

  const extensions = useMemo<readonly Extension[] | null>(() => {
    if (!text || !running || !undoManager) return null;
    const { room, recorder } = running;
    return [
      yCollab(text, room.provider.awareness, { undoManager }),
      liveEditorExtensions({
        room,
        text,
        path: relative,
        onSave: () => recorder.closeAuthor(authorKey(room.me)),
      }),
    ];
  }, [text, running, undoManager, relative]);

  const sessionId = join?.sessionId ?? "";
  const open = roomState === "ready";
  const diskText = ctx.diskText;
  return useMemo<EditorAddon>(() => {
    if (!sessionId || !relative || refused) return noAddon;
    if (text && extensions && open)
      return {
        extensions,
        document: { key: `${sessionId}:${relative}:${textKey(text)}`, text: text.toString() },
        savesItself: true,
      };
    // Waiting for the room, or the session closed: the shared text if there is one, read-only.
    return {
      extensions: locked,
      document: {
        key: `${sessionId}:${relative}:${text ? `closed:${textKey(text)}` : "waiting"}`,
        text: text ? text.toString() : diskText,
      },
      savesItself: true,
    };
  }, [sessionId, relative, refused, text, extensions, open, diskText]);
}
