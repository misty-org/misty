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
 * A search's vector, made on this computer. Without an embedding model, or for a search too short to
 * mean anything, there is none, and search by meaning finds nothing.
 */
export async function queryVector(
  query: string,
  signal?: AbortSignal,
): Promise<{ model: string; vector: number[] } | null> {
  const normalized = query.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  if (normalized.length < 3) return null;
  try {
    const { model, embeddings } = await embedOnDevice([normalized], signal);
    const vector = embeddings[0];
    return vector?.length === embeddingDimensions ? { model, vector } : null;
  } catch {
    return null;
  }
}

/**
 * Headers carrying a search's vector, so the server ranks by meaning without calling a model
 * (`withHeaderQueryEmbedding`). With no embedding model on this device there are none, and
 * search finds what it can without them.
 */
export async function queryEmbeddingHeaders(query: string): Promise<Record<string, string>> {
  const found = await queryVector(query);
  if (!found) return {};
  const { model, vector } = found;
  try {
    const bytes = new Uint8Array(new Float32Array(vector).buffer);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { "X-Misty-Query-Embedding": btoa(binary), "X-Misty-Query-Embedding-Model": model };
  } catch {
    return {};
  }
}
