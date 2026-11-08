import { embedOnDevice } from "@/api/runtime/device-embeddings";
import { localDocuments } from "../conversations/state/localChats";
import type { LocalMethod } from "./localMethods";

/**
 * Finding a saved workflow for a request. By meaning when this computer has an embedding model, with
 * vectors kept beside the workflows and made again when a workflow or the model changes; by shared
 * words when it has none. The answers keep the server's shapes (`agent_workflow_matching.go`).
 */

const kind = "workflow_vector";
/** The embed call's batch size elsewhere in the app. */
const batchSize = 32;
/** Below this a workflow isn't about the request at all, and the word match should answer instead. */
const closeEnough = 0.3;

interface StoredVector {
  id: string;
  version_id: string;
  model: string;
  vector: number[];
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => [...word].length > 2),
  );
}

/** Ranks by how many of the request's words a workflow's title, description and instructions share. */
export function matchWorkflows(methods: LocalMethod[], request: string, limit: number) {
  const wanted = words(request);
  return methods
    .map((method) => {
      const { title, description, instructions } = method.definition;
      let score = 0;
      for (const word of words(`${title} ${description} ${instructions}`))
        if (wanted.has(word)) score++;
      return { method, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ method, score }) => ({
      id: method.id,
      title: method.definition.title,
      description: method.definition.description,
      inputs: method.definition.inputs,
      shared_words: score,
    }));
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index]! * b[index]!;
    left += a[index]! * a[index]!;
    right += b[index]! * b[index]!;
  }
  return left && right ? dot / Math.sqrt(left * right) : 0;
}

async function storedVectors(account: string): Promise<Map<string, StoredVector>> {
  const documents = await localDocuments.list(account, kind);
  return new Map(
    documents.flatMap((document) => {
      try {
        const vector = JSON.parse(document) as StoredVector;
        return [[vector.id, vector] as const];
      } catch {
        return [];
      }
    }),
  );
}

async function vectorsFor(
  account: string,
  methods: LocalMethod[],
  model: string,
  signal?: AbortSignal,
): Promise<Map<string, number[]>> {
  const known = await storedVectors(account);
  const vectors = new Map<string, number[]>();
  const missing: LocalMethod[] = [];
  for (const method of methods) {
    const stored = known.get(method.id);
    if (stored?.model === model && stored.version_id === method.version_id)
      vectors.set(method.id, stored.vector);
    else missing.push(method);
  }
  for (let start = 0; start < missing.length; start += batchSize) {
    const batch = missing.slice(start, start + batchSize);
    const { embeddings } = await embedOnDevice(
      batch.map(
        ({ definition }) =>
          `${definition.title}\n${definition.description}\n${definition.instructions}`,
      ),
      signal,
    );
    await Promise.all(
      batch.map(async (method, index) => {
        const vector = embeddings[index];
        if (!vector) return;
        vectors.set(method.id, vector);
        const stored: StoredVector = {
          id: method.id,
          version_id: method.version_id,
          model,
          vector,
        };
        // A vector is only a saved model call: losing one costs the call again.
        const raw = await localDocuments.get(account, kind, method.id).catch(() => null);
        await localDocuments
          .swap(account, kind, method.id, raw, JSON.stringify(stored))
          .catch(() => false);
      }),
    );
  }
  return vectors;
}

/** The closest workflows by meaning, or none when this computer can't embed or nothing is close. */
export async function findByMeaning(
  account: string,
  methods: LocalMethod[],
  request: string,
  limit: number,
  signal?: AbortSignal,
) {
  if (!methods.length) return [];
  try {
    const { model, embeddings } = await embedOnDevice([request], signal);
    const query = embeddings[0];
    if (!query) return [];
    const vectors = await vectorsFor(account, methods, model, signal);
    return methods
      .map((method) => ({ method, score: cosine(query, vectors.get(method.id) ?? []) }))
      .filter((item) => item.score >= closeEnough)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ method }) => ({
        id: method.id,
        title: method.definition.title,
        description: method.definition.description,
        inputs: method.definition.inputs,
      }));
  } catch {
    // No key, no model, or the call failed: the word match still answers.
    return [];
  }
}
