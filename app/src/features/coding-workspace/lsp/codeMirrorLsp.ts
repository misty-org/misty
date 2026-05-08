import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { EditorView, ViewPlugin, hoverTooltip } from "@codemirror/view";
import { getLspClient, languageFor } from "./useLsp";
import { pathToUri } from "./client";

interface Position {
  line: number;
  character: number;
}

interface LspRange {
  start: Position;
  end: Position;
}

interface LspDiagnostic {
  range: LspRange;
  severity?: number;
  message: string;
  source?: string;
}

interface LspContext {
  path: string;
  language: string;
  cwd: string;
  version: number;
}

const setLspContext = StateEffect.define<LspContext | null>();

const lspContextField = StateField.define<LspContext | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setLspContext)) return effect.value;
    }
    return value;
  },
});

function offsetToPosition(doc: Text, offset: number): Position {
  const clamped = Math.min(Math.max(0, offset), doc.length);
  const line = doc.lineAt(clamped);
  return { line: line.number - 1, character: clamped - line.from };
}

function positionToOffset(doc: Text, position: Position): number {
  const lineNumber = Math.min(Math.max(1, position.line + 1), doc.lines);
  const line = doc.line(lineNumber);
  return Math.min(line.to, line.from + Math.max(0, position.character));
}

function severityToCm(severity: number | undefined): Diagnostic["severity"] {
  switch (severity) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 3:
      return "info";
    default:
      return "info";
  }
}

function applyDiagnostics(view: EditorView, path: string, diagnostics: LspDiagnostic[]) {
  const state = view.state;
  const doc = state.doc;
  const cmDiagnostics: Diagnostic[] = diagnostics.map((diagnostic) => {
    const from = positionToOffset(doc, diagnostic.range.start);
    return {
      from,
      to: Math.max(from, positionToOffset(doc, diagnostic.range.end)),
      severity: severityToCm(diagnostic.severity),
      message: diagnostic.message,
      source: diagnostic.source ?? "lsp",
    };
  });
  view.dispatch(setDiagnostics(state, cmDiagnostics));
  // suppress unused-var warning
  void path;
}

export function lspExtension(path: string, cwd: string): Extension[] {
  const language = languageFor(path);
  if (!language) return [];

  const initialContext: LspContext = { path, language, cwd, version: 1 };

  let openedOnce = false;
  let pendingDidChange: number | null = null;
  let disposed = false;
  let documentOpen = false;
  let unsubscribe: (() => void) | null = null;
  let activeClient: Awaited<ReturnType<typeof getLspClient>> = null;
  let openPromise: Promise<Awaited<ReturnType<typeof getLspClient>>> | null = null;

  const context: LspContext = { ...initialContext };

  const openDocument = (view: EditorView) => {
    if (openPromise) return openPromise;
    openedOnce = true;
    openPromise = (async () => {
      const client = await getLspClient(language, cwd);
      if (!client) return null;
      activeClient = client;
      await client.didOpen(path, language, view.state.doc.toString(), context.version);
      documentOpen = true;
      if (disposed) {
        await client.didClose(path);
        documentOpen = false;
        return null;
      }
      unsubscribe = client.onMessage((message) => {
        if (disposed || message.method !== "textDocument/publishDiagnostics") return;
        const params = message.params as { uri: string; diagnostics: LspDiagnostic[] } | undefined;
        if (!params || params.uri !== pathToUri(path)) return;
        applyDiagnostics(view, path, params.diagnostics);
      });
      return client;
    })().catch(() => null);
    return openPromise;
  };

  const updateListener = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    context.version += 1;
    const versionForCall = context.version;
    if (pendingDidChange !== null) window.clearTimeout(pendingDidChange);
    pendingDidChange = window.setTimeout(() => {
      pendingDidChange = null;
      const text = update.state.doc.toString();
      void openDocument(update.view).then((client) => {
        if (!client || disposed) return;
        return client.didChange(path, text, versionForCall);
      });
    }, 250);
  });

  const bootstrap = EditorView.domEventHandlers({
    focus: (_event, view) => {
      if (openedOnce) return false;
      void openDocument(view);
      return false;
    },
  });

  const lifecycle = ViewPlugin.define(() => ({
    destroy() {
      disposed = true;
      if (pendingDidChange !== null) window.clearTimeout(pendingDidChange);
      unsubscribe?.();
      unsubscribe = null;
      if (activeClient && documentOpen) {
        documentOpen = false;
        void activeClient.didClose(path);
      }
    },
  }));

  const hover = hoverTooltip(async (view, pos) => {
    const client = await getLspClient(language, cwd);
    if (!client) return null;
    const position = offsetToPosition(view.state.doc, pos);
    try {
      const result = await client.request<{ contents?: unknown } | null>("textDocument/hover", {
        textDocument: { uri: pathToUri(path) },
        position,
      });
      if (!result) return null;
      const rendered = renderHoverContents(result.contents);
      if (!rendered) return null;
      return {
        pos,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "cm-lsp-hover";
          dom.style.padding = "6px 10px";
          dom.style.maxWidth = "480px";
          dom.style.whiteSpace = "pre-wrap";
          dom.style.fontFamily = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace';
          dom.style.fontSize = "11.5px";
          dom.style.color = "#e0e0e0";
          dom.textContent = rendered;
          return { dom };
        },
      };
    } catch {
      return null;
    }
  });

  const completion = autocompletion({
    activateOnTyping: true,
    override: [
      async (ctx: CompletionContext): Promise<CompletionResult | null> => {
        const client = await getLspClient(language, cwd);
        if (!client) return null;
        const word = ctx.matchBefore(/[\w$]*/);
        if (!word || (word.from === word.to && !ctx.explicit)) return null;
        const position = offsetToPosition(ctx.state.doc, ctx.pos);
        try {
          const result = await client.request<
            | { items?: unknown[] }
            | { isIncomplete: boolean; items: unknown[] }
            | Array<unknown>
            | null
          >("textDocument/completion", {
            textDocument: { uri: pathToUri(path) },
            position,
          });
          const items = Array.isArray(result)
            ? result
            : ((result as { items?: unknown[] })?.items ?? []);
          const options: Completion[] = items.slice(0, 200).map((raw) => {
            const item = raw as {
              label: string;
              kind?: number;
              detail?: string;
              insertText?: string;
            };
            return {
              label: item.label,
              detail: item.detail,
              apply: item.insertText ?? item.label,
              type: completionKind(item.kind),
            };
          });
          return { from: word.from, options };
        } catch {
          return null;
        }
      },
    ],
  });

  return [
    lspContextField.init(() => initialContext),
    updateListener,
    bootstrap,
    lifecycle,
    hover,
    completion,
  ];
}

function completionKind(kind: number | undefined): Completion["type"] {
  switch (kind) {
    case 3:
      return "function";
    case 4:
      return "constructor";
    case 5:
      return "property";
    case 6:
      return "variable";
    case 7:
      return "class";
    case 8:
      return "interface";
    case 9:
      return "namespace";
    case 10:
      return "enum";
    case 14:
      return "keyword";
    case 15:
      return "text";
    case 21:
      return "constant";
    default:
      return "text";
  }
}

function renderHoverContents(contents: unknown): string | null {
  if (!contents) return null;
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents
      .map((entry) => renderHoverContents(entry) ?? "")
      .filter(Boolean)
      .join("\n\n");
  }
  if (typeof contents === "object" && contents !== null) {
    const value = (contents as { value?: unknown }).value;
    if (typeof value === "string") return value;
  }
  return null;
}
