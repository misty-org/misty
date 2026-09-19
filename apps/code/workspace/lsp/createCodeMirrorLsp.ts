import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippetCompletion,
} from "@codemirror/autocomplete";
import { forEachDiagnostic, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  hoverTooltip,
  showTooltip,
  type DecorationSet,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";
import { languageFor } from "./language";
import type { LspClient } from "./client";
import { pathToUri, uriToPath } from "./client";
import type { createEditorEphemeralStore } from "../store/createEditorEphemeralStore";
import {
  offsetToPosition,
  positionToOffset,
  type DocumentSymbol,
  type LspCodeAction,
  type LspDiagnostic,
  type LspLocation,
  type LspRange,
  type Position,
  type TextEdit,
  type WorkspaceEdit,
} from "./lspOperations";
export * from "./lspOperations";

export interface CodeMirrorLspServices {
  getLspClient(language: string, cwd: string): Promise<LspClient | null>;
  editorStore: ReturnType<typeof createEditorEphemeralStore>;
  events: EventTarget;
}

/** Complete language intelligence with diagnostics and navigation owned by one Code runtime. */
export function createCodeMirrorLsp(services: CodeMirrorLspServices) {
  const { getLspClient, editorStore, events } = services;

  interface LspContext {
    path: string;
    language: string;
    cwd: string;
    version: number;
  }

  const liveDocuments = new Map<string, Set<LspContext>>();
  const setLspContext = StateEffect.define<LspContext | null>();
  const setInlayHints = StateEffect.define<Array<{ position: number; label: string }>>();
  const setDocumentHighlights = StateEffect.define<Array<{ from: number; to: number }>>();
  const setSignatureHelp = StateEffect.define<{ position: number; label: string } | null>();
  const setManualHover = StateEffect.define<Tooltip | null>();

  const lspContextField = StateField.define<LspContext | null>({
    create: () => null,
    update(value, transaction) {
      for (const effect of transaction.effects) {
        if (effect.is(setLspContext)) return effect.value;
      }
      return value;
    },
  });

  const inlayHintsField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, transaction) {
      value = value.map(transaction.changes);
      for (const effect of transaction.effects) {
        if (effect.is(setInlayHints)) {
          return Decoration.set(
            effect.value.map((hint) =>
              Decoration.widget({ widget: new InlayHintWidget(hint.label), side: 1 }).range(
                hint.position,
              ),
            ),
            true,
          );
        }
      }
      return value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  const documentHighlightsField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, transaction) {
      value = value.map(transaction.changes);
      for (const effect of transaction.effects) {
        if (effect.is(setDocumentHighlights)) {
          return Decoration.set(
            effect.value.map((range) =>
              Decoration.mark({ class: "cm-lsp-document-highlight" }).range(range.from, range.to),
            ),
            true,
          );
        }
      }
      return value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  const signatureHelpField = StateField.define<readonly Tooltip[]>({
    create: () => [],
    update(value, transaction) {
      for (const effect of transaction.effects) {
        if (effect.is(setSignatureHelp)) {
          if (!effect.value) return [];
          const { position, label } = effect.value;
          return [
            {
              pos: position,
              above: false,
              strictSide: false,
              create: () => {
                const dom = document.createElement("div");
                dom.className = "cm-lsp-signature-help";
                dom.textContent = label;
                return { dom };
              },
            },
          ];
        }
      }
      return value;
    },
    provide: (field) => showTooltip.computeN([field], (state) => state.field(field)),
  });

  const manualHoverField = StateField.define<readonly Tooltip[]>({
    create: () => [],
    update(value, transaction) {
      for (const effect of transaction.effects) {
        if (effect.is(setManualHover)) return effect.value ? [effect.value] : [];
      }
      if (transaction.docChanged || transaction.selection) return [];
      return value;
    },
    provide: (field) => showTooltip.computeN([field], (state) => state.field(field)),
  });

  class InlayHintWidget extends WidgetType {
    constructor(readonly label: string) {
      super();
    }
    eq(other: InlayHintWidget) {
      return other.label === this.label;
    }
    toDOM() {
      const span = document.createElement("span");
      span.className = "cm-lsp-inlay-hint";
      span.textContent = this.label;
      return span;
    }
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

  function applyDiagnostics(
    view: EditorView,
    path: string,
    cwd: string,
    diagnostics: LspDiagnostic[],
  ) {
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
    editorStore.getState().setProjectDiagnostics(
      cwd,
      path,
      diagnostics.map((diagnostic) => ({
        path,
        fromLine: diagnostic.range.start.line,
        fromCharacter: diagnostic.range.start.character,
        toLine: diagnostic.range.end.line,
        toCharacter: diagnostic.range.end.character,
        severity:
          diagnostic.severity === 1 ? "error" : diagnostic.severity === 2 ? "warning" : "info",
        message: diagnostic.message,
        source: diagnostic.source,
      })),
    );
  }

  async function goToDefinition(
    view: EditorView,
    path: string,
    cwd: string,
    viewId?: string,
  ): Promise<boolean> {
    const language = languageFor(path);
    if (!language) return false;
    const client = await getLspClient(language, cwd);
    if (!client) return false;
    const head = view.state.selection.main.head;
    const position = offsetToPosition(view.state.doc, head);
    try {
      const result = await client.request<
        | { uri: string; range: LspRange }
        | Array<{
            uri?: string;
            range?: LspRange;
            targetUri?: string;
            targetRange?: LspRange;
            targetSelectionRange?: LspRange;
          }>
        | null
      >("textDocument/definition", {
        textDocument: { uri: pathToUri(path) },
        position,
      });
      if (!result) return false;
      const target = Array.isArray(result) ? result[0] : result;
      if (!target) return false;
      const targetUri =
        "targetUri" in target && target.targetUri
          ? target.targetUri
          : "uri" in target
            ? target.uri
            : undefined;
      const targetRange =
        "targetSelectionRange" in target && target.targetSelectionRange
          ? target.targetSelectionRange
          : "targetRange" in target && target.targetRange
            ? target.targetRange
            : "range" in target
              ? target.range
              : undefined;
      if (!targetUri || !targetRange) return false;
      const targetPath = uriToPath(targetUri);
      const targetLine = targetRange.start.line + 1;
      if (targetPath === path) {
        const doc = view.state.doc;
        const targetOffset = positionToOffset(doc, targetRange.start);
        view.dispatch({
          selection: { anchor: targetOffset, head: targetOffset },
          scrollIntoView: true,
        });
        view.focus();
        return true;
      }
      const fileName = targetPath.split("/").pop() ?? "file";
      if (!viewId) return false;
      events.dispatchEvent(
        new CustomEvent("misty:code-open-file", {
          detail: { path: targetPath, name: fileName, line: targetLine, viewId },
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async function showSymbolInformation(
    view: EditorView,
    path: string,
    cwd: string,
  ): Promise<boolean> {
    const client = await clientFor(path, cwd);
    if (!client) return false;
    const pos = view.state.selection.main.head;
    try {
      const result = await client.request<{ contents?: unknown } | null>("textDocument/hover", {
        textDocument: { uri: pathToUri(path) },
        position: offsetToPosition(view.state.doc, pos),
      });
      const rendered = renderHoverContents(result?.contents);
      if (!rendered) return false;
      view.dispatch({ effects: setManualHover.of(lspHoverTooltip(pos, rendered)) });
      return true;
    } catch {
      return false;
    }
  }

  async function formatDocument(
    view: EditorView,
    path: string,
    cwd: string,
    tabSize = 2,
  ): Promise<boolean> {
    if (view.state.readOnly) return false;
    const requestedDoc = view.state.doc;
    const language = languageFor(path);
    if (!language) return false;
    const client = await getLspClient(language, cwd);
    if (!client) return false;
    try {
      const edits = await client.request<TextEdit[] | null>("textDocument/formatting", {
        textDocument: { uri: pathToUri(path) },
        options: {
          tabSize,
          insertSpaces: true,
        },
      });
      // Formatting edits refer to the submitted document version. Never apply
      // their offsets to text the user changed while the server was working.
      if (!edits || edits.length === 0 || view.state.doc !== requestedDoc) return false;
      const doc = view.state.doc;
      const changes = edits.map((edit) => ({
        from: positionToOffset(doc, edit.range.start),
        to: positionToOffset(doc, edit.range.end),
        insert: edit.newText,
      }));
      view.dispatch({ changes });
      return true;
    } catch {
      return false;
    }
  }

  async function findReferences(
    view: EditorView,
    path: string,
    cwd: string,
  ): Promise<LspLocation[]> {
    const client = await clientFor(path, cwd);
    if (!client) return [];
    return client
      .request<LspLocation[] | null>("textDocument/references", {
        textDocument: { uri: pathToUri(path) },
        position: offsetToPosition(view.state.doc, view.state.selection.main.head),
        context: { includeDeclaration: true },
      })
      .then((result) => result ?? [])
      .catch(() => []);
  }

  async function findReferencesAt(
    path: string,
    cwd: string,
    position: Position,
  ): Promise<LspLocation[]> {
    const client = await clientFor(path, cwd);
    if (!client) return [];
    return client
      .request<LspLocation[] | null>("textDocument/references", {
        textDocument: { uri: pathToUri(path) },
        position,
        context: { includeDeclaration: true },
      })
      .then((result) => result ?? [])
      .catch(() => []);
  }

  async function renameSymbol(
    view: EditorView,
    path: string,
    cwd: string,
    newName: string,
  ): Promise<WorkspaceEdit | null> {
    const client = await clientFor(path, cwd);
    if (!client) return null;
    return client
      .request<WorkspaceEdit | null>("textDocument/rename", {
        textDocument: { uri: pathToUri(path) },
        position: offsetToPosition(view.state.doc, view.state.selection.main.head),
        newName,
      })
      .catch(() => null);
  }

  async function documentSymbols(path: string, cwd: string): Promise<DocumentSymbol[]> {
    const client = await clientFor(path, cwd);
    if (!client) return [];
    return client
      .request<DocumentSymbol[] | null>("textDocument/documentSymbol", {
        textDocument: { uri: pathToUri(path) },
      })
      .then((result) => result ?? [])
      .catch(() => []);
  }

  async function codeActions(
    view: EditorView,
    path: string,
    cwd: string,
  ): Promise<LspCodeAction[]> {
    const client = await clientFor(path, cwd);
    if (!client) return [];
    const { from, to } = view.state.selection.main;
    const diagnostics: Array<{
      range: LspRange;
      severity?: number;
      message: string;
      source?: string;
    }> = [];
    forEachDiagnostic(view.state, (diagnostic) =>
      diagnostics.push({
        range: {
          start: offsetToPosition(view.state.doc, diagnostic.from),
          end: offsetToPosition(view.state.doc, diagnostic.to),
        },
        severity: diagnostic.severity === "error" ? 1 : diagnostic.severity === "warning" ? 2 : 3,
        message: diagnostic.message,
        source: diagnostic.source,
      }),
    );
    return client
      .request<LspCodeAction[] | null>("textDocument/codeAction", {
        textDocument: { uri: pathToUri(path) },
        range: {
          start: offsetToPosition(view.state.doc, from),
          end: offsetToPosition(view.state.doc, to),
        },
        context: { diagnostics },
      })
      .then((result) => result ?? [])
      .catch(() => []);
  }

  async function executeLspCommand(path: string, cwd: string, command: LspCodeAction["command"]) {
    if (!command) return;
    const client = await clientFor(path, cwd);
    await client?.request("workspace/executeCommand", {
      command: command.command,
      arguments: command.arguments ?? [],
    });
  }

  async function clientFor(path: string, cwd: string) {
    const language = languageFor(path);
    return language ? getLspClient(language, cwd) : null;
  }

  function lspExtension(path: string, cwd: string, _viewId: string): Extension[] {
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
        if (!client || disposed) return null;
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
          const params = message.params as
            { uri: string; diagnostics: LspDiagnostic[] } | undefined;
          if (!params || params.uri !== pathToUri(path)) return;
          applyDiagnostics(view, path, cwd, params.diagnostics);
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
        void openDocument(update.view)
          .then((client) => {
            if (!client || disposed) return;
            return client.didChange(path, text, versionForCall);
          })
          .catch(() => undefined);
      }, 250);
    });

    const bootstrap = EditorView.domEventHandlers({
      focus: (_event, view) => {
        if (openedOnce) return false;
        void openDocument(view);
        return false;
      },
    });

    const lifecycle = ViewPlugin.define(() => {
      const key = JSON.stringify([cwd, path]);
      let contexts = liveDocuments.get(key);
      if (!contexts) liveDocuments.set(key, (contexts = new Set()));
      contexts.add(context);
      return {
        destroy() {
          contexts.delete(context);
          if (!contexts.size) liveDocuments.delete(key);
          disposed = true;
          if (pendingDidChange !== null) window.clearTimeout(pendingDidChange);
          unsubscribe?.();
          unsubscribe = null;
          if (activeClient && documentOpen) {
            documentOpen = false;
            void activeClient.didClose(path).catch(() => undefined);
          }
        },
      };
    });

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
        return lspHoverTooltip(pos, rendered);
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
                insertTextFormat?: number;
              };
              const completion: Completion = {
                label: item.label,
                detail: item.detail,
                apply: item.insertText ?? item.label,
                type: completionKind(item.kind),
              };
              return item.insertTextFormat === 2
                ? snippetCompletion(item.insertText ?? item.label, completion)
                : completion;
            });
            return { from: word.from, options };
          } catch {
            return null;
          }
        },
      ],
    });

    const languageIntelligence = ViewPlugin.fromClass(
      class {
        private hintTimer: number | null = null;
        private highlightTimer: number | null = null;

        constructor(private view: EditorView) {
          this.scheduleHints();
          this.scheduleHighlights();
        }

        update(update: ViewUpdate) {
          this.view = update.view;
          if (update.docChanged) {
            this.scheduleHints();
            const head = update.state.selection.main.head;
            const trigger = head > 0 ? update.state.sliceDoc(head - 1, head) : "";
            if (trigger === "(" || trigger === ",") void this.requestSignature();
            else
              window.setTimeout(() => {
                if (!disposed) update.view.dispatch({ effects: setSignatureHelp.of(null) });
              }, 0);
          }
          if (update.selectionSet || update.docChanged) this.scheduleHighlights();
        }

        private scheduleHints() {
          if (this.hintTimer !== null) window.clearTimeout(this.hintTimer);
          this.hintTimer = window.setTimeout(() => {
            this.hintTimer = null;
            void this.requestHints();
          }, 350);
        }

        private scheduleHighlights() {
          if (this.highlightTimer !== null) window.clearTimeout(this.highlightTimer);
          this.highlightTimer = window.setTimeout(() => {
            this.highlightTimer = null;
            void this.requestHighlights();
          }, 180);
        }

        private async requestHints() {
          const client = await getLspClient(language, cwd);
          if (!client || disposed) return;
          const doc = this.view.state.doc;
          const result = await client
            .request<Array<{
              position: Position;
              label: string | Array<{ value: string }>;
            }> | null>("textDocument/inlayHint", {
              textDocument: { uri: pathToUri(path) },
              range: { start: { line: 0, character: 0 }, end: offsetToPosition(doc, doc.length) },
            })
            .catch(() => null);
          if (!result || disposed) return;
          this.view.dispatch({
            effects: setInlayHints.of(
              result.map((hint) => ({
                position: positionToOffset(this.view.state.doc, hint.position),
                label:
                  typeof hint.label === "string"
                    ? hint.label
                    : hint.label.map((part) => part.value).join(""),
              })),
            ),
          });
        }

        private async requestHighlights() {
          const client = await getLspClient(language, cwd);
          if (!client || disposed) return;
          const result = await client
            .request<Array<{ range: LspRange }> | null>("textDocument/documentHighlight", {
              textDocument: { uri: pathToUri(path) },
              position: offsetToPosition(this.view.state.doc, this.view.state.selection.main.head),
            })
            .catch(() => null);
          if (disposed) return;
          this.view.dispatch({
            effects: setDocumentHighlights.of(
              (result ?? []).map((highlight) => ({
                from: positionToOffset(this.view.state.doc, highlight.range.start),
                to: positionToOffset(this.view.state.doc, highlight.range.end),
              })),
            ),
          });
        }

        private async requestSignature() {
          const client = await getLspClient(language, cwd);
          if (!client || disposed) return;
          const head = this.view.state.selection.main.head;
          const result = await client
            .request<{
              signatures?: Array<{ label: string }>;
              activeSignature?: number;
            } | null>("textDocument/signatureHelp", {
              textDocument: { uri: pathToUri(path) },
              position: offsetToPosition(this.view.state.doc, head),
              context: { triggerKind: 2 },
            })
            .catch(() => null);
          const signature = result?.signatures?.[result.activeSignature ?? 0];
          if (!disposed)
            this.view.dispatch({
              effects: setSignatureHelp.of(
                signature ? { position: head, label: signature.label } : null,
              ),
            });
        }

        destroy() {
          if (this.hintTimer !== null) window.clearTimeout(this.hintTimer);
          if (this.highlightTimer !== null) window.clearTimeout(this.highlightTimer);
        }
      },
    );

    return [
      lspContextField.init(() => initialContext),
      inlayHintsField,
      documentHighlightsField,
      signatureHelpField,
      manualHoverField,
      updateListener,
      bootstrap,
      lifecycle,
      hover,
      completion,
      languageIntelligence,
    ];
  }

  function lspHoverTooltip(pos: number, rendered: string): Tooltip {
    return {
      pos,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-lsp-hover";
        dom.style.padding = "8px 12px";
        dom.style.maxWidth = "520px";
        dom.style.whiteSpace = "pre-wrap";
        dom.style.fontFamily = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace';
        dom.style.fontSize = "12px";
        dom.style.lineHeight = "1.5";
        dom.style.borderRadius = "6px";
        dom.style.boxShadow = "0 6px 16px rgba(0,0,0,0.35)";
        dom.textContent = rendered;
        return { dom };
      },
    };
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

  return {
    documentVersion(root: string, path: string): number | null {
      const versions = new Set(
        [...(liveDocuments.get(JSON.stringify([root, path])) ?? [])].map(
          (context) => context.version,
        ),
      );
      return versions.size === 1 ? [...versions][0] : null;
    },
    goToDefinition,
    showSymbolInformation,
    formatDocument,
    findReferences,
    findReferencesAt,
    renameSymbol,
    documentSymbols,
    codeActions,
    executeLspCommand,
    lspExtension,
  };
}
