import {
  journalAssetDownloadPath,
  MAX_JOURNAL_ASSET_BYTES,
  resolveJournalAssetUrl,
  uploadJournalAsset,
} from "@/features/journal";
import { safeTauriAssetUrl } from "@/shared/platform/tauri";

export const MAX_NOTE_ASSET_BYTES = MAX_JOURNAL_ASSET_BYTES;

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

  const asset = await uploadJournalAsset({
    kind: "note",
    spaceId: input.spaceId,
    resourceId: input.noteId,
    file: input.file,
  });
  return journalAssetDownloadPath("note", input.spaceId, input.noteId, asset.id);
}

export async function resolveNoteAssetUrl(url: string): Promise<string> {
  if (/^\/spaces\/[^/]+\/notes\/[^/]+\/assets\/[^/]+\/download$/i.test(url)) {
    return resolveJournalAssetUrl(url);
  }
  if (!url || isBrowserUrl(url)) return url;
  return safeTauriAssetUrl(url);
}

function isBrowserUrl(url: string): boolean {
  return /^(https?:|data:|blob:|asset:|tauri:)/i.test(url);
}
