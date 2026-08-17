import { linter, type Diagnostic } from "@codemirror/lint";
import { syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

const MAX_SYNTAX_ERRORS = 200;

function syntaxErrorDiagnostics(view: EditorView): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const state = view.state;
  const tree = syntaxTree(state);
  tree.iterate({
    enter: (node) => {
      if (!node.type.isError) return;
      if (diagnostics.length >= MAX_SYNTAX_ERRORS) return false;
      const from = node.from;
      const to = Math.max(node.to, node.from + 1);
      diagnostics.push({
        from,
        to: Math.min(to, state.doc.length),
        severity: "error",
        message: "Syntax error",
        source: "parser",
      });
      return;
    },
  });
  return diagnostics;
}

export const syntaxErrorLinter: Extension = linter(syntaxErrorDiagnostics, {
  delay: 300,
});

export function lintersFor(_filename: string): Extension[] {
  return [syntaxErrorLinter];
}
