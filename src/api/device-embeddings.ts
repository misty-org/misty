import { deviceModelCall } from "@/api/device-models";

/** The server's vector size for search and memory. */
const embeddingDimensions = 768;

/** Vectors on this computer's embedding model, at the server's size, with that model's ID. */
export function embedOnDevice(values: string[], signal?: AbortSignal) {
  return deviceModelCall<{ model: string; embeddings: number[][] }>(
    "embed",
    { values, dimensions: embeddingDimensions },
    signal,
  );
}

/**
 * Headers carrying a search's vector, so the server ranks by meaning without calling a model
 * (`withHeaderQueryEmbedding`). With no embedding model on this device there are none, and
 * search finds what it can without them.
 */
export async function queryEmbeddingHeaders(query: string): Promise<Record<string, string>> {
  const normalized = query.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  if (normalized.length < 3) return {};
  try {
    const { model, embeddings } = await embedOnDevice([normalized]);
    const vector = embeddings[0];
    if (!vector || vector.length !== embeddingDimensions) return {};
    const bytes = new Uint8Array(new Float32Array(vector).buffer);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { "X-Misty-Query-Embedding": btoa(binary), "X-Misty-Query-Embedding-Model": model };
  } catch {
    return {};
  }
}
