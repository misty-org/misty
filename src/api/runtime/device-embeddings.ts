import { deviceModelCall } from "@/api/runtime/device-models";

/** The vector size asked of the embedding model. A model that answers in another size is fine. */
const embeddingDimensions = 768;

/** Vectors on this computer's embedding model, with that model's ID. */
export async function embedOnDevice(values: string[], signal?: AbortSignal) {
  const answer = await deviceModelCall<{ model: string; embeddings: number[][] }>(
    "embed",
    { values, dimensions: embeddingDimensions },
    signal,
  );
  return answer;
}

/**
 * A search's vector, made on this computer. Without an embedding model, or for a search too short to
 * mean anything, there is none, and search goes by its words alone.
 */
export async function queryVector(
  query: string,
  signal?: AbortSignal,
): Promise<{ model: string; vector: number[] } | null> {
  const normalized = query.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  if (normalized.length < 3) return null;
  try {
    const { model, embeddings } = await embedOnDevice([normalized.slice(0, 4000)], signal);
    const vector = embeddings[0];
    return vector?.length ? { model, vector } : null;
  } catch {
    return null;
  }
}
