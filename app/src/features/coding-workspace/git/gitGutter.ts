import { RangeSet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import type { GitDiff } from "./useGitStore";

class DiffMarker extends GutterMarker {
  constructor(private readonly color: string) {
    super();
  }
  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.style.width = "2px";
    el.style.height = "100%";
    el.style.background = this.color;
    return el;
  }
}

const ADD = new DiffMarker("#a8c090");
const MOD = new DiffMarker("#d4b880");
const DEL = new DiffMarker("#d68b80");

interface DiffField {
  diff: GitDiff | null;
}

const setGitDiff = StateEffect.define<GitDiff | null>();

const gitDiffField = StateField.define<DiffField>({
  create: () => ({ diff: null }),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setGitDiff)) {
        return { diff: effect.value };
      }
    }
    return value;
  },
});

function markerFor(field: DiffField, line: number): GutterMarker | null {
  const diff = field.diff;
  if (!diff) return null;
  if (diff.deletions.has(line) && !diff.additions.has(line) && !diff.modifications.has(line)) {
    return DEL;
  }
  if (diff.modifications.has(line)) return MOD;
  if (diff.additions.has(line)) return ADD;
  return null;
}

const gitGutterExtension: Extension = [
  gitDiffField,
  gutter({
    class: "misty-git-gutter",
    lineMarker: (view, blockLine) => {
      const field = view.state.field(gitDiffField, false);
      if (!field) return null;
      const line = view.state.doc.lineAt(blockLine.from).number;
      return markerFor(field, line);
    },
    initialSpacer: () => new DiffMarker("transparent"),
    markers: () => RangeSet.empty,
  }),
  EditorView.theme({
    ".misty-git-gutter": {
      width: "2px",
      background: "transparent",
      borderLeft: "1px solid transparent",
      paddingLeft: 0,
      paddingRight: 0,
    },
    ".misty-git-gutter .cm-gutterElement": {
      padding: 0,
    },
  }),
];

export function gitGutter(): Extension {
  return gitGutterExtension;
}

export function pushGitDiff(view: EditorView, diff: GitDiff | null): void {
  view.dispatch({ effects: setGitDiff.of(diff) });
}
