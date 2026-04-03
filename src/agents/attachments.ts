import { managedAiRequest } from "../stores/aiServerApi";
import type { PreparedAgentDocument, PreparedDocumentSection } from "./types";

const cipherMagic = new TextEncoder().encode("MSTY1");
const maxAttachmentBytes = 50 * 1024 * 1024;
const maxBatchSections = 50;
const maxBatchImages = 8;
const maxBatchPayloadBytes = 5 * 1024 * 1024;

interface AttachmentEnvelopeResponse {
  keyId: string;
  keyWrapAlgorithm: "RSA-OAEP-SHA256";
  publicKey: string;
}

interface JobEnvelope {
  key: CryptoKey;
  wrappedDataKey: string;
  keyId: string;
}

interface InitiatedAttachment {
  attachment: { id: string };
  uploadToken: string;
}

export interface DocumentAttachmentReference {
  attachmentId: string;
  scopeId: string;
  relativePath: string;
}

export interface PreparedDocumentBatch {
  document: PreparedAgentDocument;
  cursor: number;
  nextCursor: number | null;
}

const jobEnvelopes = new Map<string, Promise<JobEnvelope>>();

export function preparedDocumentBatch(document: PreparedAgentDocument, cursor = 0): PreparedDocumentBatch {
  const start = Math.max(0, Math.min(Math.trunc(cursor), document.sections.length));
  const sections: PreparedDocumentSection[] = [];
  let imageCount = 0;
	let payloadBytes = 0;
  let index = start;
  for (; index < document.sections.length && sections.length < maxBatchSections; index += 1) {
    const section = document.sections[index];
    const hasImage = Boolean(section.imageDataUrl);
    // A requires-OCR section without an image marks the first page that must
    // be rendered by the next native preparation batch.
    if (section.requiresOcr && !hasImage) break;
    if (hasImage && imageCount >= maxBatchImages) break;
		const sectionBytes = new TextEncoder().encode(JSON.stringify(section)).byteLength;
		if (sections.length > 0 && payloadBytes + sectionBytes > maxBatchPayloadBytes) break;
    sections.push(section);
		payloadBytes += sectionBytes;
    if (hasImage) imageCount += 1;
  }
  if (sections.length === 0 && start < document.sections.length) {
    // Preserve progress and a precise location even when native OCR rendering
    // is unavailable; Mika can report that page as unread instead of looping.
    sections.push(document.sections[start]);
    index = start + 1;
  }
  const nextCursor = index < document.sections.length ? index : null;
  return {
    cursor: start,
    nextCursor,
    document: { ...document, sections, truncated: document.truncated || nextCursor !== null },
  };
}

export async function uploadPreparedDocumentBatch(
  jobId: string,
  scopeId: string,
  relativePath: string,
  batch: PreparedDocumentBatch,
): Promise<DocumentAttachmentReference> {
  const envelope = await jobEnvelope(jobId);
  const plaintextDocument = {
    documentId: batch.document.documentId,
    fileName: batch.document.displayName,
    mimeType: batch.document.mimeType,
    sizeBytes: batch.document.sizeBytes,
    scopeId,
    relativePath,
    sections: batch.document.sections,
    truncated: batch.document.truncated,
    requiresOcr: batch.document.requiresOcr,
    nextCursor: batch.nextCursor === null ? "" : String(batch.nextCursor),
    hasMore: batch.nextCursor !== null,
  };
  const plaintext = new TextEncoder().encode(JSON.stringify(plaintextDocument));
  if (plaintext.byteLength < 1 || plaintext.byteLength > maxAttachmentBytes) {
    throw new Error("The prepared document batch exceeds Misty’s 50 MiB encrypted upload limit.");
  }
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: cipherMagic, tagLength: 128 },
    envelope.key,
    plaintext,
  ));
  const ciphertext = concatenate(cipherMagic, nonce, sealed);
	const ciphertextBuffer = ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength) as ArrayBuffer;
	const ciphertextSha256 = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", ciphertextBuffer)));
  let initiated: InitiatedAttachment | null = null;
  try {
    initiated = await managedAiRequest<InitiatedAttachment>(`/agents/jobs/${encodeURIComponent(jobId)}/attachments/initiate`, {
      method: "POST",
      body: JSON.stringify({
		documentId: batch.document.documentId,
        displayName: batch.document.displayName,
        mediaType: "application/vnd.misty.agent-document+json",
        plaintextByteSize: plaintext.byteLength,
        ciphertextByteSize: ciphertext.byteLength,
        pageCount: batch.document.sections.length,
        ciphertextSha256,
        wrappedDataKey: envelope.wrappedDataKey,
        keyWrapAlgorithm: "RSA-OAEP-SHA256",
        keyWrapKeyId: envelope.keyId,
        contentEncryption: "AES-256-GCM",
      }),
    });
		await managedAiRequest(`/agents/jobs/${encodeURIComponent(jobId)}/attachments/${encodeURIComponent(initiated.attachment.id)}/content`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/octet-stream",
				"X-Misty-Attachment-Upload-Token": initiated.uploadToken,
			},
			body: ciphertextBuffer,
		});
    await managedAiRequest(`/agents/jobs/${encodeURIComponent(jobId)}/attachments/${encodeURIComponent(initiated.attachment.id)}/finalize`, {
      method: "POST",
      body: JSON.stringify({ uploadToken: initiated.uploadToken }),
    });
    return { attachmentId: initiated.attachment.id, scopeId, relativePath };
  } catch (error) {
    if (initiated) {
      await managedAiRequest(`/agents/jobs/${encodeURIComponent(jobId)}/attachments/${encodeURIComponent(initiated.attachment.id)}`, { method: "DELETE" }).catch(() => undefined);
    }
    throw error;
  }
}

export function forgetJobAttachmentEnvelope(jobId: string): void {
  jobEnvelopes.delete(jobId);
}

async function jobEnvelope(jobId: string): Promise<JobEnvelope> {
  let pending = jobEnvelopes.get(jobId);
  if (!pending) {
    pending = createJobEnvelope();
    jobEnvelopes.set(jobId, pending);
    pending.catch(() => jobEnvelopes.delete(jobId));
  }
  return pending;
}

async function createJobEnvelope(): Promise<JobEnvelope> {
  const server = await managedAiRequest<AttachmentEnvelopeResponse>("/agents/attachments/envelope");
  if (server.keyWrapAlgorithm !== "RSA-OAEP-SHA256" || !server.keyId || !server.publicKey) {
    throw new Error("Misty’s attachment encryption key is unavailable.");
  }
  const publicKey = await crypto.subtle.importKey(
    "spki",
    fromBase64(server.publicKey),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["wrapKey"],
  );
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const wrapped = await crypto.subtle.wrapKey("raw", key, publicKey, { name: "RSA-OAEP" });
  return { key, wrappedDataKey: toBase64(new Uint8Array(wrapped)), keyId: server.keyId };
}

function concatenate(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
