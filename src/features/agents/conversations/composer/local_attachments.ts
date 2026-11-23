import { agentAccountId } from "../../personal/agent_account";
import { localDocuments } from "../state/local_chats";
import type { MistyImageAttachment } from "../state/conversation_types";

interface RunAttachment {
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

const fromBase64 = (
  Uint8Array as unknown as { fromBase64?: (text: string) => Uint8Array<ArrayBuffer> }
).fromBase64;

function blobOfDataUrl(url: string, mimeType: string): Blob {
  const base64 = url.slice(url.indexOf(",") + 1);
  if (fromBase64) return new Blob([fromBase64.call(Uint8Array, base64)], { type: mimeType });
  const binary = atob(base64);
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

export async function localAttachmentImage(id: string): Promise<Blob> {
  const row = await read(agentAccountId(), id);
  if (!row) throw new Error("This attachment is no longer on this computer.");
  return blobOfDataUrl(row.data_url, row.mime_type);
}

export async function localAttachmentFile(id: string): Promise<Blob> {
  const row = await read(agentAccountId(), id);
  if (!row) throw new Error("This attachment is no longer on this computer.");
  return blobOfDataUrl(row.original_data_url, row.original_mime_type);
}
