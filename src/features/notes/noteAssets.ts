import type {
  NoteAssetStoreRequest,
  NoteAssetStoreResult,
} from "@/models/interfaces/services/misty-api";
import { notesStoreAsset } from "@/stores/backend/useMistyBackendStore";
import { hasTauriInternals, safeTauriAssetUrl } from "@/platform/tauri";

export const MAX_NOTE_ASSET_BYTES = 15 * 1024 * 1024;

export interface UploadNoteAssetInput {
  accountId?: string;
  spaceId?: string;
  noteId: string;
  file: File;
}

export async function uploadNoteAsset(input: UploadNoteAssetInput): Promise<string> {
  if (!input.spaceId) throw new Error("Open a Space before adding files to a note.");
  if (input.file.size > MAX_NOTE_ASSET_BYTES) {
    throw new Error("Note files must be 15 MB or smaller for this beta.");
  }

  if (!hasTauriInternals()) return readFileAsDataUrl(input.file);

  if (!input.accountId) throw new Error("Sign in before adding files to a note.");
  const bytes = Array.from(new Uint8Array(await input.file.arrayBuffer()));
  const request: NoteAssetStoreRequest = {
    accountId: input.accountId,
    spaceId: input.spaceId,
    noteId: input.noteId,
    fileName: input.file.name || "note-asset",
    mimeType: input.file.type || null,
    bytes,
  };
  const stored: NoteAssetStoreResult = await notesStoreAsset(request);
  return stored.path;
}

export async function resolveNoteAssetUrl(url: string): Promise<string> {
  if (!url || isBrowserUrl(url)) return url;
  return safeTauriAssetUrl(url);
}

function isBrowserUrl(url: string): boolean {
  return /^(https?:|data:|blob:|asset:|tauri:)/i.test(url);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Misty could not read this note file."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}
