import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { NoteReadingPaneView, type NoteReadingRuntime } from "./NoteReadingPaneView";
import type { NoteEditorSession } from "./NoteBlockEditorView";
import type { UnifiedNote } from "../model/types/types";

it("does not seed a title before sync or let a viewer edit it", () => {
  const doc = new Y.Doc(),
    awareness = new Awareness(doc);
  const listeners = new Set<() => void>();
  const provider = {
    awareness,
    synced: false,
    on: (_event: unknown, listener: () => void) => {
      listeners.add(listener);
    },
    off: (_event: unknown, listener: () => void) => {
      listeners.delete(listener);
    },
  } as unknown as NoteEditorSession["provider"];
  const session: NoteEditorSession = {
    key: "room",
    doc,
    fragment: doc.getXmlFragment("tiptap"),
    title: doc.getText("misty:title"),
    markdown: doc.getText("misty:markdown"),
    metadata: doc.getMap("misty:document"),
    provider,
    role: "editor",
  };
  const runtime: NoteReadingRuntime = {
    subscribeRename: () => () => {},
    useCollaborationRoom: () => ({ session, error: null, notice: null }),
    backlinks: async () => ({ backlinks: [] }),
    Editor: () => <div>SDK editor</div>,
  };
  const note = {
    id: "note-a",
    sourceId: "note-a",
    title: "Projection",
    source: "misty",
    spaceId: "space-a",
    body: "",
    bodyFormat: "markdown",
  } as UnifiedNote;
  const view = render(
    <NoteReadingPaneView runtime={runtime} note={note} loading={false} onNewNote={vi.fn()} />,
  );
  expect(session.title.toString()).toBe("");
  act(() => {
    session.title.insert(0, "Remote title");
    provider.synced = true;
    listeners.forEach((listener) => listener());
  });
  expect(session.title.toString()).toBe("Remote title");
  expect((screen.getByLabelText("Note title") as HTMLInputElement).value).toBe("Remote title");
  session.role = "viewer";
  view.rerender(
    <NoteReadingPaneView runtime={runtime} note={note} loading={false} onNewNote={vi.fn()} />,
  );
  expect((screen.getByLabelText("Note title") as HTMLInputElement).readOnly).toBe(true);
  fireEvent.change(screen.getByLabelText("Note title"), { target: { value: "forbidden" } });
  expect(session.title.toString()).toBe("Remote title");
  view.unmount();
  awareness.destroy();
  doc.destroy();
});
