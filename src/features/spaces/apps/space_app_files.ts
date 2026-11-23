export interface AppFileUse {
  user_id: string;
  name: string;
  editing: boolean;
  you: boolean;
}

export interface AppFileRef {
  id: string;
  name: string;
  mime: string;
  size: number;
  folder?: string;
  updated_at: string;
  in_use?: AppFileUse[];
}

export interface FileHost {
  openRoute(path: string): void;
  pickFiles(options: { accept: string[]; multiple: boolean }): Promise<AppFileRef[]>;
  saved(file: AppFileRef, how?: "new" | "version" | "kept"): void;
}

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
