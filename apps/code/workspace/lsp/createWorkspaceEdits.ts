import type { createCodingWorkspaceStore } from "../store/createCodingWorkspaceStore";
import type { WorkspaceEdit, TextEdit } from "./lspOperations";
import { applyTextEdits } from "./textEdits";
export { applyTextEdits } from "./textEdits";
export interface WorkspaceEditFilePreview {
  readonly path: string;
  readonly original: string;
  readonly proposed: string;
  readonly edits: readonly TextEdit[];
  readonly changedLines: readonly number[];
}
export interface WorkspaceEditPreview {
  readonly id: string;
  readonly rootPath: string;
  readonly title: string;
  readonly files: readonly WorkspaceEditFilePreview[];
}
/** Shared data only. SDK access and version readers belong to individual adapters. */
export function createWorkspaceEditState() {
  return {
    previews: new Map<
      string,
      { preview: WorkspaceEditPreview; versions: Map<string, number>; owner: symbol }
    >(),
    preparing: new Map<string, { token: symbol; owner: symbol }>(),
    readers: new Map<symbol, (root: string, path: string) => number | null>(),
    closed: false,
    close() {
      this.closed = true;
      this.previews.clear();
      this.preparing.clear();
      this.readers.clear();
    },
  };
}
export function createWorkspaceEdits(services: {
  store: ReturnType<typeof createCodingWorkspaceStore>;
  ensureBuffer(root: string, path: string): Promise<unknown>;
  flushBuffer?(root: string, path: string): void;
  documentVersion?(root: string, path: string): number | null;
  assertWritable?(root: string): void;
  signal?: AbortSignal;
  maxFileBytes?: number;
  state?: ReturnType<typeof createWorkspaceEditState>;
}) {
  const state = services.state ?? createWorkspaceEditState();
  const { previews, preparing } = state;
  const owner = Symbol();
  if (services.documentVersion) state.readers.set(owner, services.documentVersion);
  let closed = false;
  const assert = () => {
    if (closed || state.closed || services.signal?.aborted)
      throw new Error("This edit preview owner is closed.");
  };
  const buffer = (root: string, path: string) => {
    assert();
    services.assertWritable?.(root);
    services.flushBuffer?.(root, path);
    const value = services.store.getState().projectBuffers[root]?.[path];
    if (!value || value.loading || (value.error && !value.loaded))
      throw new Error(`Could not load ${path.split("/").pop()} for the edit.`);
    if (value.readonly) throw new Error("This edit includes a read-only file.");
    return value;
  };
  const version = (root: string, path: string, expected?: number, allowClosed = false) => {
    if (allowClosed && services.documentVersion?.(root, path) === null) return;
    if (expected !== undefined && services.documentVersion?.(root, path) !== expected)
      throw new Error("The document version changed or is unavailable. Run the action again.");
  };
  const close = () => {
    closed = true;
    for (const [id, preparation] of preparing)
      if (preparation.owner === owner) preparing.delete(id);
    state.readers.delete(owner);
    if (!services.state) state.close();
    services.signal?.removeEventListener("abort", close);
  };
  services.signal?.addEventListener("abort", close, { once: true });
  if (services.signal?.aborted) close();
  return {
    close,
    async prepareWorkspaceEdit(id: string, rootPath: string, title: string, edit: WorkspaceEdit) {
      assert();
      if (!id || id.length > 256 || title.length > 1024)
        throw new Error("Invalid edit preview identity.");
      if (
        !previews.has(id) &&
        !preparing.has(id) &&
        new Set([...previews.keys(), ...preparing.keys()]).size >= 32
      )
        throw new Error("Apply or discard an old edit preview before preparing another.");
      const normalized = normalize(rootPath, edit);
      const token = Symbol();
      previews.delete(id);
      preparing.set(id, { token, owner });
      const check = () => {
        assert();
        if (preparing.get(id)?.token !== token)
          throw new Error("This edit preview was replaced or discarded.");
      };
      try {
        const files: WorkspaceEditFilePreview[] = [],
          versions = new Map<string, number>();
        let bytes = 0;
        for (const [path, item] of normalized) {
          check();
          services.flushBuffer?.(rootPath, path);
          await services.ensureBuffer(rootPath, path);
          check();
          version(rootPath, path, item.version);
          const original = buffer(rootPath, path).contents;
          const proposed = applyTextEdits(original, item.edits);
          const proposedBytes = new TextEncoder().encode(proposed).byteLength;
          if (proposedBytes > (services.maxFileBytes ?? Number.POSITIVE_INFINITY))
            throw new Error("An edited file exceeds its writable size limit.");
          bytes += new TextEncoder().encode(original).byteLength + proposedBytes;
          if (bytes > 32 * 1024 * 1024)
            throw new Error("This edit preview exceeds its size limit.");
          if (item.version !== undefined) versions.set(path, item.version);
          files.push(
            Object.freeze({
              path,
              original,
              proposed,
              edits: Object.freeze(item.edits),
              changedLines: Object.freeze([
                ...new Set(item.edits.map((e) => e.range.start.line + 1)),
              ]),
            }),
          );
        }
        check();
        for (const file of files) {
          version(rootPath, file.path, versions.get(file.path));
          if (buffer(rootPath, file.path).contents !== file.original)
            throw new Error("A file changed while preparing this preview. Run the action again.");
        }
        const preview = Object.freeze({ id, rootPath, title, files: Object.freeze(files) });
        previews.set(id, { preview, versions, owner });
        return preview;
      } finally {
        if (preparing.get(id)?.token === token) preparing.delete(id);
      }
    },
    getWorkspaceEditPreview(id: string) {
      return closed || state.closed ? null : (previews.get(id)?.preview ?? null);
    },
    discardWorkspaceEditPreview(id: string) {
      assert();
      preparing.delete(id);
      previews.delete(id);
    },
    applyWorkspaceEditPreview(id: string) {
      assert();
      const held = previews.get(id);
      if (!held) return false;
      const { preview, versions } = held;
      for (const file of preview.files) {
        const reader = state.readers.get(held.owner);
        const expected = versions.get(file.path);
        const currentVersion = reader?.(preview.rootPath, file.path) ?? null;
        if (expected !== undefined && currentVersion !== null && currentVersion !== expected)
          throw new Error("The document version changed. Run the action again.");
        if (buffer(preview.rootPath, file.path).contents !== file.original)
          throw new Error("A file changed since this preview. Run the action again.");
      }
      // Publish every edited buffer together; subscribers never see a partial edit.
      services.store.setState((state) => {
        const project = { ...state.projectBuffers[preview.rootPath] };
        for (const file of preview.files) {
          const current = project[file.path];
          if (!current || current.loading || current.readonly || current.contents !== file.original)
            throw new Error("A file changed since this preview. Run the action again.");
        }
        for (const file of preview.files)
          project[file.path] = { ...project[file.path], contents: file.proposed };
        return { projectBuffers: { ...state.projectBuffers, [preview.rootPath]: project } };
      });
      previews.delete(id);
      return true;
    },
  };
}
function normalize(root: string, edit: WorkspaceEdit) {
  const result = new Map<string, { edits: TextEdit[]; version?: number }>();
  if (!edit || typeof edit !== "object" || Array.isArray(edit))
    throw new Error("Invalid workspace edit.");
  if (edit.changes && edit.documentChanges)
    throw new Error("An edit must use one document change format.");
  let count = 0;
  const add = (uri: string, edits: TextEdit[], version?: number | null) => {
    const parsed = new URL(uri);
    if (
      parsed.protocol !== "file:" ||
      (parsed.hostname && parsed.hostname !== "localhost") ||
      parsed.search ||
      parsed.hash
    )
      throw new Error("This edit references an unsupported document URI.");
    const path = decodeURIComponent(parsed.pathname);
    if (
      !path.startsWith(root.endsWith("/") ? root : `${root}/`) ||
      path.split("/").some((p) => p === ".." || p === "." || p.includes("\0"))
    )
      throw new Error("This edit references a file outside the project.");
    if (!Array.isArray(edits) || (count += edits.length) > 8192)
      throw new Error("Too many workspace edits.");
    if (version != null && (!Number.isSafeInteger(version) || version < 0))
      throw new Error("Invalid document version.");
    const existing = result.get(path);
    if (existing && existing.version !== (version ?? undefined))
      throw new Error("Conflicting document edit versions.");
    const copied = structuredClone(edits) as TextEdit[];
    for (const e of copied) {
      if (!e?.range?.start || !e.range.end || typeof e.newText !== "string")
        throw new Error("Invalid text edit.");
      Object.freeze(e.range.start);
      Object.freeze(e.range.end);
      Object.freeze(e.range);
      Object.freeze(e);
    }
    result.set(path, {
      edits: [...(existing?.edits ?? []), ...copied],
      version: version ?? undefined,
    });
    if (result.size > 256) throw new Error("This edit affects too many files.");
  };
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) add(uri, edits);
  for (const change of edit.documentChanges ?? []) {
    if (!change.textDocument?.uri || !change.edits)
      throw new Error("This action contains unsupported file operations.");
    add(change.textDocument.uri, change.edits, change.textDocument.version);
  }
  return result;
}
