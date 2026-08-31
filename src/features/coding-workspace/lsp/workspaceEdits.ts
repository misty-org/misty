import { uriToPath } from "./client";
import type { TextEdit, WorkspaceEdit } from "./codeMirrorLsp";
import { ensureProjectBuffer } from "../openFile";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";

export interface WorkspaceEditFilePreview {
  path: string;
  original: string;
  proposed: string;
  edits: TextEdit[];
  changedLines: number[];
}

export interface WorkspaceEditPreview {
  id: string;
  rootPath: string;
  title: string;
  files: WorkspaceEditFilePreview[];
}

const previews = new Map<string, WorkspaceEditPreview>();

export async function prepareWorkspaceEdit(
  id: string,
  rootPath: string,
  title: string,
  workspaceEdit: WorkspaceEdit,
) {
  const normalized = normalizeWorkspaceEdit(workspaceEdit);
  const files: WorkspaceEditFilePreview[] = [];
  for (const [path, edits] of normalized) {
    const buffer = await ensureProjectBuffer(rootPath, path, basename(path));
    if (!buffer || buffer.error) continue;
    const proposed = applyTextEdits(buffer.contents, edits);
    files.push({
      path,
      original: buffer.contents,
      proposed,
      edits,
      changedLines: [...new Set(edits.map((edit) => edit.range.start.line + 1))],
    });
  }
  const preview = { id, rootPath, title, files };
  previews.set(id, preview);
  return preview;
}

export function getWorkspaceEditPreview(id: string) {
  return previews.get(id) ?? null;
}

export function applyWorkspaceEditPreview(id: string) {
  const preview = previews.get(id);
  if (!preview) return false;
  const store = useCodingWorkspaceStore.getState();
  for (const file of preview.files) {
    if (store.projectBuffers[preview.rootPath]?.[file.path]) {
      store.updateBufferContents(preview.rootPath, file.path, file.proposed);
    }
  }
  previews.delete(id);
  return true;
}

export function discardWorkspaceEditPreview(id: string) {
  previews.delete(id);
}

function normalizeWorkspaceEdit(edit: WorkspaceEdit) {
  const byPath = new Map<string, TextEdit[]>();
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
    byPath.set(uriToPath(uri), [...(byPath.get(uriToPath(uri)) ?? []), ...edits]);
  }
  for (const change of edit.documentChanges ?? []) {
    if (!change.textDocument?.uri || !change.edits) continue;
    const path = uriToPath(change.textDocument.uri);
    byPath.set(path, [...(byPath.get(path) ?? []), ...change.edits]);
  }
  return byPath;
}

export function applyTextEdits(contents: string, edits: TextEdit[]) {
  const offsets = lineOffsets(contents);
  return edits
    .map((edit) => ({
      from: offsetAt(offsets, contents.length, edit.range.start.line, edit.range.start.character),
      to: offsetAt(offsets, contents.length, edit.range.end.line, edit.range.end.character),
      insert: edit.newText,
    }))
    .sort((a, b) => b.from - a.from)
    .reduce(
      (value, edit) => value.slice(0, edit.from) + edit.insert + value.slice(edit.to),
      contents,
    );
}

function lineOffsets(contents: string) {
  const offsets = [0];
  for (let index = 0; index < contents.length; index += 1) {
    if (contents[index] === "\n") offsets.push(index + 1);
  }
  return offsets;
}

function offsetAt(offsets: number[], length: number, line: number, character: number) {
  const start = offsets[Math.min(Math.max(0, line), offsets.length - 1)] ?? 0;
  return Math.min(length, start + Math.max(0, character));
}

function basename(path: string) {
  return path.split("/").filter(Boolean).pop() ?? path;
}
