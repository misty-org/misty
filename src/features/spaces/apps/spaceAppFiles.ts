import { spacesApi } from "../api/api";
import type { SpaceLibraryItem } from "../api/dto/entities";
import { uploadLibraryBlob } from "../api/library-upload";
import { libraryItemMIME } from "../library";
import { HostError } from "./protocol";

type Call = (params: Record<string, unknown>) => Promise<unknown>;

/** The most items one `files.list` page returns. */
const MAX_PAGE = 200;

/** What an app is shown of a Space's file. */
export interface AppFileRef {
  id: string;
  name: string;
  mime: string;
  size: number;
  updated_at: string;
}

/** What the host does for the file calls that need the person: showing a picker, saying something was saved. */
export interface FileHost {
  /** Opens a Space page of the host (a file in Media). */
  openRoute(path: string): void;
  /** Asks the person for files from the Space's Media; empty when they cancel. */
  pickFiles(options: { accept: string[]; multiple: boolean }): Promise<AppFileRef[]>;
  /** An app saved a file into Media. */
  saved(file: AppFileRef): void;
}

/** A Space's Media item as an app sees a file. */
export function fileRef(item: SpaceLibraryItem): AppFileRef {
  const size = Number(item.file.intrinsic_metadata.byte_size ?? 0);
  return {
    id: item.id,
    name: item.display_name || item.file.original_filename || "Untitled file",
    mime: libraryItemMIME(item),
    size: Number.isFinite(size) ? size : 0,
    updated_at: item.updated_at || item.added_at,
  };
}

/** Whether a mime type matches what an app accepts: `image/*`, `.psd`, or an exact type. */
export function acceptsFile(accept: readonly string[], mime: string, name: string): boolean {
  if (!accept.length) return true;
  const lower = name.toLowerCase();
  return accept.some((kind) =>
    kind.endsWith("/*")
      ? mime.startsWith(kind.slice(0, -1))
      : kind.startsWith(".")
        ? lower.endsWith(kind.toLowerCase())
        : mime === kind,
  );
}

const blobOf = (value: unknown, mime: string): Blob => {
  if (value instanceof Blob) return mime && !value.type ? new Blob([value], { type: mime }) : value;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value))
    return new Blob([value as BlobPart], { type: mime });
  throw new HostError("invalid", "The file's bytes are missing.");
};

/**
 * The SDK's `files.*` calls the host answers: list, upload and save (into Media), pick (the person chooses from
 * Media), download, and open (which opens the item in the Space's Media page). Watching waits for its own support.
 */
export function createFileCalls(spaceId: string, host: FileHost): Record<string, Call> {
  const upload: Call = async ({ name, mime, data }) => {
    if (typeof name !== "string" || !name.trim())
      throw new HostError("invalid", "The file needs a name.");
    const type = typeof mime === "string" ? mime : "application/octet-stream";
    const saved = await uploadLibraryBlob(spaceId, blobOf(data, type), name.trim());
    if (!saved.item)
      throw new HostError("internal", "The file was uploaded but not added to Media.");
    return fileRef(saved.item);
  };
  return {
    "files.list": async ({ accept, limit, cursor }) => {
      const result = await spacesApi.libraryItems(spaceId, {
        sort: "recently-added",
        direction: "desc",
        limit: Math.min(typeof limit === "number" && limit > 0 ? limit : 100, MAX_PAGE),
        after: typeof cursor === "string" && cursor ? cursor : undefined,
      });
      const kinds = Array.isArray(accept)
        ? accept.filter((kind): kind is string => typeof kind === "string")
        : [];
      const files = result.items
        .map(fileRef)
        .filter((file) => acceptsFile(kinds, file.mime, file.name));
      return { files, next_cursor: result.next_after };
    },
    "files.upload": upload,
    // An app's own Save goes into Media, and the person is told where it went.
    "files.save": async (params) => {
      const saved = (await upload(params)) as AppFileRef;
      host.saved(saved);
      return saved;
    },
    "files.pick": async ({ accept, multiple }) =>
      host.pickFiles({
        accept: Array.isArray(accept)
          ? accept.filter((kind): kind is string => typeof kind === "string")
          : [],
        multiple: multiple === true,
      }),
    "files.download": async ({ file_id: fileId }) => {
      if (typeof fileId !== "string" || !fileId)
        throw new HostError("invalid", "The file is missing.");
      const item = await spacesApi.libraryItem(spaceId, fileId);
      const content = await spacesApi.libraryOriginalContent(spaceId, fileId);
      return { file: fileRef(item), data: await content.arrayBuffer() };
    },
    "files.open": async ({ file_id: fileId }) => {
      if (typeof fileId !== "string" || !fileId)
        throw new HostError("invalid", "The file is missing.");
      host.openRoute(
        `/spaces/${encodeURIComponent(spaceId)}/media?item=${encodeURIComponent(fileId)}`,
      );
    },
  };
}
