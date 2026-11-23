import type { Failure, FileHead } from "@/features/files";
import type { FileItem, FileSource } from "../model";

export type SourceKind = FileSource["kind"];

export interface FileSourceAdapter {
  kind: SourceKind;
  local: boolean;
  canRename: boolean;
  canTrash: boolean;
  inTrash: boolean;
  rename?(item: FileItem, name: string, replace?: boolean): Promise<string>;
  trash?(items: FileItem[]): Promise<Failure[]>;
  restore?(items: FileItem[]): Promise<Failure[]>;
  purge?(items: FileItem[]): Promise<Failure[]>;
  reveal?(item: FileItem): Promise<void>;
  previewUrl(item: FileItem): string | undefined;
  readHead?(item: FileItem, limit: number): Promise<FileHead>;
}

export function failuresOf(value: unknown): Failure[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((each: unknown) => {
    if (!each || typeof each !== "object") return [];
    const said = each as Partial<Failure>;
    return typeof said.error === "string"
      ? [{ path: typeof said.path === "string" ? said.path : "", error: said.error }]
      : [];
  });
}

export function headOf(bytes: ArrayBuffer, size: number, limit: number): FileHead {
  const view = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, limit));
  return {
    text: new TextDecoder("utf-8", { fatal: false }).decode(view),
    truncated: size > view.byteLength,
    binary: view.includes(0),
  };
}
