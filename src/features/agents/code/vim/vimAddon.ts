import { indentUnit } from "@codemirror/language";
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { getCM, Vim, vim } from "@replit/codemirror-vim";
import { useEffect, useMemo } from "react";
import { useCodeStatus } from "../codeStatus";
import { editorCommandsOf } from "../editorCommands";
import { noAddon, type EditorAddon, type EditorAddonContext } from "../editorAddons";
import { useEditorNvimMappings, useEditorVim } from "./editorVimSettings";
import { useNvimConfig, type NvimConfig, type NvimMapping, type NvimOptions } from "./nvimConfig";

/**
 * Ex commands the editor's vim already knows, so a mapping that runs one of them works. A mapping
 * to anything else (a plugin's command, Lua) would only report an error, so it isn't taken.
 */
const knownEx = new Set([
  "w",
  "write",
  "q",
  "quit",
  "wq",
  "x",
  "xit",
  "e",
  "edit",
  "s",
  "substitute",
  "g",
  "global",
  "v",
  "vglobal",
  "d",
  "delete",
  "y",
  "yank",
  "j",
  "join",
  "m",
  "move",
  "sort",
  "normal",
  "norm",
  "noh",
  "nohl",
  "nohlsearch",
  "marks",
  "registers",
  "undo",
  "u",
  "redo",
  "red",
  "set",
  "se",
]);

/** The editor's vim contexts for Neovim's mapping modes; operator-pending has none. */
const contexts: Partial<Record<NvimMapping["mode"], string>> = {
  n: "normal",
  x: "visual",
  i: "insert",
};

/** Keys as the editor's vim spells them: a bare space is `<Space>`, `<Cmd>…<CR>` an Ex call. */
function editorKeys(keys: string): string {
  return keys.replace(/ /g, "<Space>").replace(/^<cmd>/i, ":");
}

/** Whether the editor can run a mapping's right-hand side. */
export function runnable(rhs: string): boolean {
  if (/<plug>|<sid>|v:lua|<expr>|luaeval|\blua\b|\bcall\b/i.test(rhs)) return false;
  const ex = /^(?::|<cmd>)\s*([A-Za-z]+)/i.exec(rhs);
  if (ex) return knownEx.has(ex[1]) && /<cr>$/i.test(rhs);
  return true;
}

/** The mappings the editor took, one per mode and keys. Vim's mappings are global to the page. */
let applied: NvimConfig | null = null;

function applyMappings(config: NvimConfig | null) {
  if (applied === config) return;
  Vim.mapclear();
  applied = config;
  if (!config) return;
  for (const mapping of config.mappings) {
    const context = contexts[mapping.mode];
    if (!context || !runnable(mapping.rhs)) continue;
    const lhs = editorKeys(mapping.lhs);
    const rhs = editorKeys(mapping.rhs);
    try {
      if (mapping.noremap) Vim.noremap(lhs, rhs, context);
      else Vim.map(lhs, rhs, context);
    } catch {
      // One mapping the editor's vim can't parse leaves the rest in place.
    }
  }
}

let exDefined = false;

/** `:w`, `:q`, `:wq`/`:x` and `:e` act on the file through the pane that holds the editor. */
function defineEx() {
  if (exDefined) return;
  exDefined = true;
  const commands = (cm: { cm6: EditorView }) => editorCommandsOf(cm.cm6);
  Vim.defineEx("write", "w", (cm) => commands(cm)?.save());
  Vim.defineEx("quit", "q", (cm) => commands(cm)?.close());
  Vim.defineEx("wq", "wq", (cm) => {
    commands(cm)?.save();
    commands(cm)?.close();
  });
  Vim.defineEx("xit", "x", (cm) => {
    commands(cm)?.save();
    commands(cm)?.close();
  });
  Vim.defineEx("edit", "e", (cm) => commands(cm)?.quickOpen());
}

/**
 * Line numbers counted from the cursor's line, as `relativenumber` shows them. The cursor's line
 * keeps its own number when `number` is on too. A new format whenever the cursor changes line is
 * what makes the gutter draw again.
 */
function relativeNumbers(absolute: boolean): Extension {
  const numbers = new Compartment();
  const format = (cursorLine: number) =>
    lineNumbers({
      formatNumber: (lineNo) =>
        lineNo === cursorLine
          ? absolute
            ? String(lineNo)
            : "0"
          : String(Math.abs(lineNo - cursorLine)),
    });
  const cursorLineOf = (state: EditorState) => state.doc.lineAt(state.selection.main.head).number;
  return [
    numbers.of(format(1)),
    ViewPlugin.define((view) => {
      let shown = 0;
      let gone = false;
      const sync = () => {
        if (gone) return;
        const line = cursorLineOf(view.state);
        if (line === shown) return;
        shown = line;
        view.dispatch({ effects: numbers.reconfigure(format(line)) });
      };
      // Dispatching inside an update isn't allowed, so the new format follows just after it.
      queueMicrotask(sync);
      return {
        update(update: ViewUpdate) {
          if (update.selectionSet || update.docChanged) queueMicrotask(sync);
        },
        destroy() {
          gone = true;
        },
      };
    }),
  ];
}

/** The editor settings Neovim's options stand for: tab width, indent, wrapping, numbers. */
function optionExtensions(options: NvimOptions): Extension[] {
  const extensions: Extension[] = [];
  if (options.tabstop) extensions.push(EditorState.tabSize.of(options.tabstop));
  const width = options.shiftwidth || options.tabstop;
  if (options.expandtab !== undefined || options.shiftwidth) {
    extensions.push(indentUnit.of(options.expandtab === false ? "\t" : " ".repeat(width || 4)));
  }
  if (options.wrap) extensions.push(EditorView.lineWrapping);
  if (options.relativenumber) extensions.push(relativeNumbers(options.number !== false));
  return extensions;
}

/** Reports vim's mode for `path` to the window's bottom bar (`CodeBarStatus.tsx`). */
function modeReporter(path: string): Extension {
  return ViewPlugin.define((view) => {
    const cm = getCM(view);
    const report = (mode: string) => useCodeStatus.getState().update(path, { vimMode: mode });
    const onModeChange = (event: { mode: string; subMode?: string }) =>
      report(
        event.subMode
          ? `${event.mode} ${event.subMode === "linewise" ? "line" : "block"}`
          : event.mode,
      );
    report("normal");
    cm?.on("vim-mode-change", onModeChange);
    return {
      destroy() {
        cm?.off("vim-mode-change", onModeChange);
        useCodeStatus.getState().update(path, { vimMode: undefined });
      },
    };
  });
}

/**
 * Vim keys in every Misty code editor while the device setting is on, with the person's own
 * Neovim mappings and options when they asked for them. Vim comes first, ahead of every other
 * keymap, so its keys win in normal mode.
 */
export function useVimAddon(ctx: EditorAddonContext): EditorAddon {
  const on = useEditorVim((state) => state.value);
  const useOwn = useEditorNvimMappings((state) => state.value);
  const config = useNvimConfig((state) => state.config);
  const { path } = ctx;

  useEffect(() => {
    if (on && useOwn) void useNvimConfig.getState().read();
  }, [on, useOwn]);
  // Mappings are global to vim, so the latest choice applies to every open editor at once.
  useEffect(() => {
    if (!on) return;
    defineEx();
    applyMappings(useOwn ? config : null);
  }, [on, useOwn, config]);

  return useMemo(() => {
    if (!on) return noAddon;
    return {
      extensions: [
        Prec.highest(vim()),
        modeReporter(path),
        ...(useOwn && config ? optionExtensions(config.options) : []),
      ],
    };
  }, [on, useOwn, config, path]);
}
