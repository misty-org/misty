import { ApiRequestError } from "@/api/client/errors";
import { embedOnDevice } from "@/api/device-embeddings";
import { devicesApi } from "@/api/devices/api";
import { diag } from "./diagnostics";
import { ensureServerAgentDevice, signedAgentDeviceRequest } from "./store/useAgentDeviceStore";
import { agentsDeviceSnapshot } from "./store/useAgentsStore";

interface Chunk {
  kind: "retrieval" | "memory";
  text?: string;
  [identity: string]: unknown;
}

const idleMs = 60_000;
// With no embedding model on this device, ask again only now and then.
const unsetMs = 10 * 60_000;

/**
 * Search and memory rank by meaning with vectors this computer makes on its own embedding model
 * (docs/agents/runtime.md). This worker claims the person's chunks that wait for one,
 * embeds them and hands the vectors back; a chunk it couldn't embed is tried again later.
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
      const snapshot = await agentsDeviceSnapshot();
      if (snapshot.device && snapshot.device.status !== "revoked") {
        const device = await ensureServerAgentDevice(snapshot.device);
        delay = await this.batch(snapshot.device.id, device.id);
      }
    } catch (error) {
      diag("embeddings", `batch failed: ${String(error)}`);
    }
    if (!this.running || this.generation !== generation) return;
    this.timer = setTimeout(() => void this.loop(generation), delay);
  }

  /** One batch; returns how long to wait before the next. */
  private async batch(localId: string, deviceId: string): Promise<number> {
    const claim = await devicesApi.claimEmbeddings<{ chunks: Chunk[] } | undefined>(
      signedAgentDeviceRequest,
      localId,
      deviceId,
    );
    const chunks = claim?.chunks ?? [];
    if (!chunks.length) return idleMs;
    const identity = (chunk: Chunk) => {
      const { text: _text, ...rest } = chunk;
      return rest;
    };
    try {
      const { model, embeddings } = await embedOnDevice(chunks.map((chunk) => chunk.text ?? ""));
      await devicesApi.completeEmbeddings(signedAgentDeviceRequest, localId, deviceId, {
        model,
        chunks: chunks.map((chunk, index) => ({ ...identity(chunk), vector: embeddings[index] })),
      });
      // A full batch means more are waiting.
      return chunks.length >= 32 ? 0 : idleMs;
    } catch (error) {
      await devicesApi
        .completeEmbeddings(signedAgentDeviceRequest, localId, deviceId, {
          model: "",
          chunks: [],
          failed: chunks.map(identity),
        })
        .catch(() => undefined);
      return error instanceof ApiRequestError && error.code === "model_key_needed"
        ? unsetMs
        : idleMs;
    }
  }
}
