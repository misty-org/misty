import { SDKSurfaceRegistration } from "@/features/ai-surface/SDKSurfaceRegistration";
import { useEffect, useRef, useState } from "react";
import type { MistyAppSDK } from "@misty/sdk";
import { usePinnedIds } from "@/shared/hooks/usePinnedIds";
import { Button } from "@/shared/ui";
import { createSdkJournalAssets, pickSdkJournalImage } from "@/features/journal/sdkJournalAssets";
import { createSdkNotesApi, createSdkNotesStore } from "./noteServices";
import { createSdkNoteCollaboration, useSdkNoteCollaborationRoom } from "./sdkNoteCollaboration";
import {
  NoteBlockEditorView,
  type NoteEditorRuntime,
  type NoteBlockEditorProps,
} from "./components/NoteBlockEditorView";
import { NoteReadingPaneView, type NoteReadingRuntime } from "./components/NoteReadingPaneView";
import { NotePreviewView } from "./components/NotePreviewView";
import { NewNoteDialogView } from "./components/NewNoteDialogView";
import { SDKNoteAiControls } from "./components/SDKNoteAiControls";
import type { NotesViewRuntime } from "./SpaceNotesView";

/** Construct once for each downloaded Journal root, then release with its mount lifetime. */
export async function createSdkNotesRuntime(input: {
  misty: MistyAppSDK;
  spaceId: string;
  userId: string;
  signal: AbortSignal;
  members: readonly { user_id: string; name: string }[];
  report(error: unknown): void;
}) {
  const { misty, spaceId, userId, signal: parentSignal, report } = input;
  if (parentSignal.aborted) throw new Error("This Journal view is closed.");
  const key = `misty:note-pins:${userId}:${spaceId}`;
  const saved = await misty.storage.local.get(key);
  if (parentSignal.aborted) throw new Error("This Journal view closed while loading preferences.");
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  let closed = false;
  const subscriptions = new Set<() => void>();
  let writes: Promise<void> = Promise.resolve();
  let pins = typeof saved === "string" ? saved : null;
  const storage: Pick<Storage, "getItem" | "setItem"> = {
    getItem: () => pins,
    setItem: (_key, value) => {
      if (!closed && !signal.aborted && pins !== value) {
        pins = value;
        writes = writes
          .catch(() => undefined)
          .then(async () => {
            if (!closed && !signal.aborted) await misty.storage.local.set(key, value);
          });
        void writes.catch(report);
      }
    },
  };
  const collaboration = createSdkNoteCollaboration(misty, spaceId, signal);
  const assets = createSdkJournalAssets(misty, spaceId, signal);
  const notes = createSdkNotesStore(misty, spaceId, collaboration.clear);
  const api = createSdkNotesApi(misty, spaceId);
  const renames = new Map<string, Set<() => void>>();
  const close = () => {
    if (closed) return;
    closed = true;
    lifetime.abort();
    parentSignal.removeEventListener("abort", close);
    collaboration.close();
    assets.close();
    notes.reset();
    renames.clear();
    for (const remove of subscriptions) remove();
    subscriptions.clear();
  };
  parentSignal.addEventListener("abort", close, { once: true });
  const editorRuntime: NoteEditorRuntime = {
    useCollaborationRoom: (space, note) => useSdkNoteCollaborationRoom(collaboration, space, note),
    uploadAsset: (input) => {
      if (input.spaceId !== spaceId || (input.accountId && input.accountId !== userId))
        throw new Error("This image belongs to another Journal view.");
      return assets.uploadNote(input.noteId, input.file);
    },
    resolveAsset: assets.resolveNote,
    renderImagePicker: (props) => (
      <ImagePicker {...props} misty={misty} signal={signal} report={report} />
    ),
    renderAiRegistration: (adapter) => (
      <SDKSurfaceRegistration misty={misty} adapter={adapter} report={report} />
    ),
    renderAiSelection: (_adapter, selection) => (
      <SDKNoteAiControls misty={misty} selection={selection} report={report} />
    ),
    renderError: (error) => <ErrorNotice error={error} report={report} />,
    reportError: report,
    openCitation: (citation) => {
      void misty.links.openExternal(citation.href).catch(report);
    },
  };
  const Editor = (props: Omit<NoteBlockEditorProps, "runtime">) => (
    <NoteBlockEditorView {...props} runtime={editorRuntime} />
  );
  const readingRuntime: NoteReadingRuntime = {
    Editor,
    backlinks: api.backlinks,
    useCollaborationRoom: editorRuntime.useCollaborationRoom,
    subscribeRename(noteId, listener) {
      const listeners = renames.get(noteId) ?? new Set<() => void>();
      renames.set(noteId, listeners);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) renames.delete(noteId);
      };
    },
  };
  const runtime: NotesViewRuntime = {
    user: { id: userId },
    members: input.members,
    referenceOnly: false,
    presentation: "desktop",
    useStore: notes.useStore,
    usePinnedIds: (key, ids, loading) => usePinnedIds(storage, key, ids, loading),
    subscribeChanges(listener) {
      let disposed = false,
        remove: (() => void) | undefined;
      const unsubscribe = () => {
        disposed = true;
        remove?.();
        subscriptions.delete(unsubscribe);
      };
      if (closed) return unsubscribe;
      subscriptions.add(unsubscribe);
      void misty.data
        .subscribe("notes", () => {
          if (!disposed && !closed) listener();
        })
        .then((cleanup) => {
          if (disposed || closed) cleanup();
          else remove = cleanup;
        })
        .catch(report);
      return unsubscribe;
    },
    renameNote: (noteId) => {
      if (!closed) renames.get(noteId)?.forEach((listener) => listener());
    },
    ReadingPane: (props) => <NoteReadingPaneView {...props} runtime={readingRuntime} />,
    Preview: (props) => (
      <NotePreviewView {...props} runtime={{ Editor, copy: misty.clipboard.writeText, report }} />
    ),
    NewNoteDialog: (props) => <NewNoteDialogView {...props} mobile={false} />,
    renderIntegration: ({ title }) => <Integration misty={misty} title={title} report={report} />,
  };
  return { runtime, close, store: notes.useStore };
}

function Integration({
  misty,
  title,
  report,
}: {
  misty: MistyAppSDK;
  title: string;
  report(error: unknown): void;
}) {
  useEffect(() => {
    void misty.workspace
      .setTitle(
        [...title]
          .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
          .join("")
          .slice(0, 160) || "Notes",
      )
      .catch(report);
  }, [misty, title, report]);
  return null;
}
function ErrorNotice({ error, report }: { error: string; report(error: unknown): void }) {
  useEffect(() => report(error), [error, report]);
  return (
    <p role="alert" className="px-4 text-sm text-cream-muted">
      {error}
    </p>
  );
}
function ImagePicker({
  misty,
  signal,
  report,
  onSelect,
  onCancel,
}: {
  misty: MistyAppSDK;
  signal: AbortSignal;
  report(error: unknown): void;
  onSelect(file: File): void;
  onCancel(): void;
}) {
  const pending = useRef<Promise<File | undefined> | null>(null);
  const [error, setError] = useState("");
  const current = useRef({ onSelect, onCancel, report });
  current.current = { onSelect, onCancel, report };
  useEffect(() => {
    let active = true;
    pending.current ??= pickSdkJournalImage(misty, signal);
    void pending.current
      .then((file) => {
        if (!active || signal.aborted) return;
        if (file) current.current.onSelect(file);
        else current.current.onCancel();
      })
      .catch((reason) => {
        if (active && !signal.aborted) {
          setError(reason instanceof Error ? reason.message : "The image could not be opened.");
          current.current.report(reason);
        }
      });
    return () => {
      active = false;
    };
  }, [misty, signal]);
  return (
    <div
      className="absolute inset-x-3 bottom-3 z-30 flex items-center gap-3 rounded-md border border-charcoal-border bg-charcoal-card p-3 text-sm text-cream"
      role="status"
    >
      <span className="flex-1">{error || "Choose an image in the file picker…"}</span>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        {error ? "Close" : "Cancel"}
      </Button>
    </div>
  );
}
