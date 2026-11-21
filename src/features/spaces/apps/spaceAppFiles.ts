/** What an app is shown of a Space's file. */
export interface AppFileRef {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** Its folder's path in the Space's drive (`/Design`), for a drive file. */
  folder?: string;
  updated_at: string;
}

/** What the host does for the file calls that need the person: showing a picker, saying something was saved. */
export interface FileHost {
  /** Opens a Space page of the host (a file in Files). */
  openRoute(path: string): void;
  /** Asks the person for files from the Space's Files; empty when they cancel. */
  pickFiles(options: { accept: string[]; multiple: boolean }): Promise<AppFileRef[]>;
  /** An app saved a file into Files. `kept` says a save of an opened file someone else changed was kept as a copy. */
  saved(file: AppFileRef, how?: "new" | "version" | "kept"): void;
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
