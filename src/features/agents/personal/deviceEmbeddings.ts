import { ApiRequestError } from "@/api/client/errors";
import { embedOnDevice } from "@/api/runtime/device-embeddings";
import { deviceMemory } from "@/api/runtime/device-memory";
import { diag } from "../runs/jobs/diagnostics";

const idleMs = 60_000;
// With no embedding model on this device, ask again only now and then.
const unsetMs = 10 * 60_000;

const memoryBatchSize = 32;

/** One batch of what memory on this computer waits for; returns how long to wait before the next. */
export async function memoryBatch(): Promise<number> {
  const claimed = await deviceMemory.claimChunks(memoryBatchSize);
  if (!claimed.length) return idleMs;
  const keys = claimed.map(({ text: _text, ...key }) => key);
  try {
    const { model, embeddings } = await embedOnDevice(claimed.map((chunk) => chunk.text));
    await deviceMemory.completeChunks({
      model,
      chunks: keys.map((key, index) => ({ ...key, vector: embeddings[index] })),
    });
    return claimed.length >= memoryBatchSize ? 0 : idleMs;
  } catch (error) {
    await deviceMemory.completeChunks({ failed: keys }).catch(() => undefined);
    return error instanceof ApiRequestError && error.code === "model_key_needed" ? unsetMs : idleMs;
  }
}

/**
 * Memory ranks by meaning with vectors this computer makes on its own embedding model
 * This worker claims what memory on this computer waits for, embeds it and
 * hands the vectors back; a chunk it couldn't embed is tried again later.
 */
export class DeviceEmbeddingWorker {
  private running = false;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;

  start(): void {
    if (this.running) return;
    this.running = true;
    const generation = ++this.generation;
    void this.loop(generation);
  }

  stop(): void {
    this.running = false;
    this.generation++;
    clearTimeout(this.timer);
  }

  private async loop(generation: number): Promise<void> {
    if (!this.running || this.generation !== generation) return;
    let delay = idleMs;
    try {
      delay = await memoryBatch();
    } catch (error) {
      diag("embeddings", `memory batch failed: ${String(error)}`);
    }
    if (!this.running || this.generation !== generation) return;
    if (!this.running || this.generation !== generation) return;
    this.timer = setTimeout(() => void this.loop(generation), delay);
  }
}
