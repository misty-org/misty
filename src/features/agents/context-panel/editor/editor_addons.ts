import type { Extension } from "@codemirror/state";
import { createPort } from "@/shared/lib/seams";

export type EditorAppearance = "panel" | "page";

export interface EditorAddonContext {
  path: string;
  root: string;
  appearance: EditorAppearance;
  diskText: string;
}

export interface EditorAddon {
  extensions: readonly Extension[];
  document?: { key: string; text: string };
  savesItself?: boolean;
}

export const noAddon: EditorAddon = { extensions: [] };

const useNoAddon = (_ctx: EditorAddonContext): EditorAddon => noAddon;

export const editorAddons =
  createPort<(ctx: EditorAddonContext) => EditorAddon>("the editor's addons");

export const useEditorAddons = (ctx: EditorAddonContext): EditorAddon =>
  (editorAddons.maybe() ?? useNoAddon)(ctx);
