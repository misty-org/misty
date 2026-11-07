import { agentAccountId } from "@/features/agents/agentAccount";
import { localDocuments } from "./localChats";
import type { MistyImageAttachment } from "./types";

/**
 * A chat's attachments stay on this computer, in misty.db. A row holds
 * the rendition the model reads, and the original when it's small enough to keep for `browser.upload`.
 */

/** What a turn's run reads, in the shape `companion_images.rs` reads. */
export interface RunAttachment {
  id: string;
  name: string;
  mime_type: string;
  data_url: string;
  width: number;
  height: number;
  content_hash: string;
}

interface Stored extends RunAttachment {
  byte_size: number;
  created_at: string;
  /** The file as it was attached, for handing to a page. */
  original_mime_type: string;
  original_data_url: string;
}

export function dataUrl(bytes: ArrayBuffer, mimeType: string): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let offset = 0; offset < view.length; offset += 0x8000)
    binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export function blobOfDataUrl(url: string, mimeType: string): Blob {
  const binary = atob(url.slice(url.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

export async function saveLocalAttachment(row: Stored): Promise<void> {
  await localDocuments.swap(agentAccountId(), "attachment", row.id, null, JSON.stringify(row));
}

async function read(account: string, id: string): Promise<Stored | null> {
  const raw = await localDocuments.get(account, "attachment", id);
  return raw ? (JSON.parse(raw) as Stored) : null;
}

export async function deleteLocalAttachment(attachment: Pick<MistyImageAttachment, "id">) {
  await localDocuments.remove(agentAccountId(), "attachment", attachment.id);
}

/** The attachments a turn sends. One that's gone is left out. */
export async function localAttachmentsForRun(
  account: string,
  ids: string[],
): Promise<RunAttachment[]> {
  const rows = await Promise.all(ids.map((id) => read(account, id).catch(() => null)));
  return rows.flatMap((row) =>
    row
      ? [
          {
            id: row.id,
            name: row.name,
            mime_type: row.mime_type,
            data_url: row.data_url,
            width: row.width,
            height: row.height,
            content_hash: row.content_hash,
          },
        ]
      : [],
  );
}

/** What a chat shows and what the model read. */
export async function localAttachmentImage(id: string): Promise<Blob> {
  const row = await read(agentAccountId(), id);
  if (!row) throw new Error("This attachment is no longer on this computer.");
  return blobOfDataUrl(row.data_url, row.mime_type);
}

/** The file as it was attached, for a page that asks for it. */
export async function localAttachmentFile(id: string): Promise<Blob> {
  const row = await read(agentAccountId(), id);
  if (!row) throw new Error("This attachment is no longer on this computer.");
  return blobOfDataUrl(row.original_data_url, row.original_mime_type);
}
