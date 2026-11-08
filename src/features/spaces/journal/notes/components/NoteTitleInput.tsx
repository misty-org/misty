import { Input } from "@/shared/ui";
import { useEffect, useRef, useState } from "react";
import type { Text as YText } from "yjs";
import type { NoteReadingRuntime } from "./NoteReadingPaneView";

/** The note's title, edited live in its collaboration room. */
export function NoteTitleInput(props: {
  runtime: NoteReadingRuntime;
  spaceId: string;
  noteId: string;
  initialTitle: string;
  renameRequested?: boolean;
  onRenameHandled?: () => void;
}) {
  const { session } = props.runtime.useCollaborationRoom(props.spaceId, props.noteId);
  const [title, setTitle] = useState(props.initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);
  const { renameRequested, onRenameHandled } = props;
  useEffect(() => {
    if (!renameRequested || !session) return;
    const focus = () => {
      if (!session.provider.synced) return;
      if (session.role !== "viewer") {
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      onRenameHandled?.();
    };
    focus();
    session.provider.on("sync", focus);
    return () => session.provider.off("sync", focus);
  }, [renameRequested, onRenameHandled, session]);
  useEffect(() => {
    if (!session) return;
    let initialized = false;
    const sync = () => {
      if (!initialized && session.provider.synced) {
        initialized = true;
        if (
          session.provider.synced &&
          session.role !== "viewer" &&
          !session.title.length &&
          props.initialTitle
        )
          replaceYText(session.title, props.initialTitle);
      }
      setTitle(session.title.toString() || props.initialTitle);
    };
    sync();
    session.title.observe(sync);
    session.provider.on("sync", sync);
    return () => {
      session.title.unobserve(sync);
      session.provider.off("sync", sync);
    };
  }, [props.initialTitle, session]);
  useEffect(
    () =>
      props.runtime.subscribeRename(props.noteId, () => {
        if (session?.role === "viewer") return;
        inputRef.current?.focus();
        inputRef.current?.select();
      }),
    [props.noteId, props.runtime, session?.role],
  );
  return (
    <Input
      ref={inputRef}
      className="h-8 max-w-md text-sm font-semibold text-cream-bright"
      value={title}
      maxLength={500}
      aria-label="Note title"
      readOnly={!session || session.role === "viewer"}
      onChange={(event) => {
        setTitle(event.target.value);
        if (session && session.role !== "viewer") replaceYText(session.title, event.target.value);
      }}
      onBlur={() => {
        if (!title.trim() && session && session.role !== "viewer")
          replaceYText(session.title, "Untitled note");
      }}
    />
  );
}
function replaceYText(text: YText, value: string) {
  if (text.toString() === value) return;
  text.doc?.transact(() => {
    text.delete(0, text.length);
    text.insert(0, value);
  }, "misty-title");
}
