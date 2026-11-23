import { CodeBlock } from "@tiptap/extension-code-block";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { ThemedToken } from "shiki/core";
import { codeLanguage } from "@/shared/lib/highlight/code_languages";

const highlightKey = new PluginKey<DecorationSet>("noteCodeHighlight");
const LIMIT = 64;
const tokens = new Map<string, ThemedToken[][]>();

function remember(key: string, lines: ThemedToken[][]) {
  if (tokens.size >= LIMIT) {
    const oldest = tokens.keys().next().value;
    if (oldest !== undefined) tokens.delete(oldest);
  }
  tokens.set(key, lines);
}

function highlight(
  doc: ProseNode,
  name: string,
  request: (language: string, code: string) => void,
) {
  const marks: Decoration[] = [];
  doc.descendants((node, position) => {
    if (node.type.name !== name) return true;
    const language = codeLanguage(node.attrs.language as string | undefined);
    if (!language) return false;
    const code = node.textContent;
    const lines = tokens.get(`${language}\u0000${code}`);
    if (!lines) {
      request(language, code);
      return false;
    }
    let from = position + 1;
    for (const line of lines) {
      for (const token of line) {
        const to = from + token.content.length;
        if (token.color && to > from)
          marks.push(Decoration.inline(from, to, { style: `color: ${token.color}` }));
        from = to;
      }
      from += 1;
    }
    return false;
  });
  return DecorationSet.create(doc, marks);
}

function highlightPlugin(name: string) {
  let view: EditorView | undefined;
  const pending = new Set<string>();
  const request = (language: string, code: string) => {
    const key = `${language}\u0000${code}`;
    if (pending.has(key)) return;
    pending.add(key);
    void import("@/shared/lib/highlight/shiki_highlighter")
      .then(({ tokenize }) => tokenize(code, language))
      .then(
        (lines) => remember(key, lines),
        () => remember(key, []),
      )
      .finally(() => {
        pending.delete(key);
        if (view && !view.isDestroyed) view.dispatch(view.state.tr.setMeta(highlightKey, true));
      });
  };
  return new Plugin<DecorationSet>({
    key: highlightKey,
    state: {
      init: (_, state) => highlight(state.doc, name, request),
      apply: (transaction, current, _previous, state) =>
        transaction.docChanged || transaction.getMeta(highlightKey)
          ? highlight(state.doc, name, request)
          : current,
    },
    props: {
      decorations: (state) => highlightKey.getState(state),
    },
    view(editorView) {
      view = editorView;
      return {
        destroy() {
          view = undefined;
        },
      };
    },
  });
}

export const NoteCodeBlock = CodeBlock.extend({
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), highlightPlugin(this.name)];
  },
});
