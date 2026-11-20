import { Prec, RangeSet, StateEffect, type Extension, type Range } from "@codemirror/state";
import {
  EditorView,
  GutterMarker,
  ViewPlugin,
  gutter,
  keymap,
  type PluginValue,
  type ViewUpdate,
} from "@codemirror/view";
import { ySyncAnnotation, ySyncFacet, yUndoManagerKeymap } from "y-codemirror.next";
import type * as Y from "yjs";
import { personColor } from "../../tutor/personTone";
import { writerOf, type LiveRoom } from "./liveRoom";
import { useLiveStore } from "./liveStore";
import { itemText } from "./liveText";

/**
 * What a live editor adds beside `yCollab`: ⌘Z through the session's undo manager (only this
 * person's own edits), ⌘S closing their open steps, the file they're in for everyone's presence,
 * a start from the shared text even when the editor was handed an older copy, and a thin mark
 * beside each line in the color of whoever wrote it ("Show only" narrows it to one author).
 */

class AuthorMark extends GutterMarker {
  constructor(
    readonly color: string,
    readonly agent: boolean,
  ) {
    super();
  }

  override eq(other: GutterMarker) {
    return other instanceof AuthorMark && other.color === this.color && other.agent === this.agent;
  }

  override toDOM() {
    const mark = document.createElement("span");
    mark.className = "cm-live-author";
    // The person's own presence color, the one their caret and avatar wear.
    mark.style.backgroundColor = this.color;
    if (this.agent) mark.dataset.agent = "";
    return mark;
  }
}

const refresh = StateEffect.define<null>();
const refreshDelayMs = 300;

/** The writer of most of each line's authored text, by line start. */
function lineWriters(room: LiveRoom, text: Y.Text, only: string | null): Map<number, string> {
  const counts = new Map<number, Map<string, number>>();
  const content = text.toString();
  let at = 0;
  let lineStart = 0;
  for (let item = text._start; item; item = item.right) {
    if (item.deleted || !item.countable) continue;
    const piece = itemText(item);
    if (piece === null) continue;
    const key = writerOf(room, item.id.client);
    for (let index = 0; index < piece.length; index++) {
      const position = at + index;
      if (key && key !== "main" && (!only || only === key) && piece[index] !== "\n") {
        const line = counts.get(lineStart) ?? new Map<string, number>();
        line.set(key, (line.get(key) ?? 0) + 1);
        counts.set(lineStart, line);
      }
      if (content[position] === "\n") lineStart = position + 1;
    }
    at += piece.length;
  }
  const writers = new Map<number, string>();
  for (const [line, keys] of counts) {
    const top = [...keys.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) writers.set(line, top[0]);
  }
  return writers;
}

function markFor(key: string): AuthorMark | null {
  const person = /^person:(.+)$/.exec(key);
  if (person) return new AuthorMark(personColor(person[1]!), false);
  const agent = /^agent:([^:]+):/.exec(key);
  return agent ? new AuthorMark(personColor(agent[1]!), true) : null;
}

function authorPlugin(room: LiveRoom, text: Y.Text) {
  return ViewPlugin.fromClass(
    class implements PluginValue {
      markers: RangeSet<GutterMarker> = RangeSet.empty;
      timer = 0;
      stopStore: () => void;
      constructor(readonly view: EditorView) {
        text.observe(this.later);
        this.stopStore = useLiveStore.subscribe((state, before) => {
          if (state.only !== before.only) this.later();
        });
        this.later();
      }
      later = () => {
        window.clearTimeout(this.timer);
        this.timer = window.setTimeout(
          () => this.view.dispatch({ effects: refresh.of(null) }),
          refreshDelayMs,
        );
      };
      update(update: ViewUpdate) {
        if (update.docChanged) this.markers = this.markers.map(update.changes);
        if (!update.transactions.some((tr) => tr.effects.some((effect) => effect.is(refresh))))
          return;
        // Only while the editor shows the shared text: marks are laid out by its offsets.
        if (update.state.doc.length !== text.length) return;
        const marks: Array<Range<GutterMarker>> = [];
        for (const [line, key] of lineWriters(room, text, useLiveStore.getState().only)) {
          const mark = markFor(key);
          if (mark && line <= update.state.doc.length) marks.push(mark.range(line));
        }
        this.markers = RangeSet.of(marks, true);
      }
      destroy() {
        window.clearTimeout(this.timer);
        text.unobserve(this.later);
        this.stopStore();
      }
    },
  );
}

/** The editor starts over from the shared text if it was given anything else. */
const startFromShared = ViewPlugin.fromClass(
  class implements PluginValue {
    constructor(view: EditorView) {
      queueMicrotask(() => {
        const sync = view.state.facet(ySyncFacet);
        if (!sync || !view.dom.isConnected) return;
        const shared = sync.ytext.toString();
        if (shared === view.state.doc.toString()) return;
        // Marked as the sync's own change, so it isn't written back into the shared text.
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: shared },
          annotations: [ySyncAnnotation.of(sync)],
        });
      });
    }
  },
);

const authorTheme = EditorView.baseTheme({
  ".cm-live-authors .cm-gutterElement": { padding: "0 2px 0 0" },
  ".cm-live-author": { display: "block", width: "2px", height: "100%" },
  ".cm-live-author[data-agent]": { opacity: "0.55" },
});

export function liveEditorExtensions(options: {
  room: LiveRoom;
  text: Y.Text;
  path: string;
  onSave(): void;
}): Extension {
  const { room, text, path } = options;
  const authors = authorPlugin(room, text);
  return [
    startFromShared,
    Prec.high(
      keymap.of([
        ...yUndoManagerKeymap,
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            options.onSave();
            return true;
          },
        },
      ]),
    ),
    EditorView.updateListener.of((update) => {
      if (update.focusChanged && update.view.hasFocus)
        room.awareness.setLocalStateField("path", path);
    }),
    authors,
    gutter({
      class: "cm-live-authors",
      markers: (view) => view.plugin(authors)?.markers ?? RangeSet.empty,
    }),
    authorTheme,
  ];
}
