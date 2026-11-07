import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/api/client/errors";

const fixture = vi.hoisted(() => ({ invoke: vi.fn(), embed: vi.fn() }));

vi.mock("@/native/invoke", () => ({ invoke: fixture.invoke }));
vi.mock("@/api/device-embeddings", () => ({ embedOnDevice: fixture.embed }));
vi.mock("@/api/devices/api", () => ({ devicesApi: {} }));
vi.mock("./diagnostics", () => ({ diag: vi.fn() }));
vi.mock("./store/useAgentDeviceStore", () => ({
  ensureAgentDevice: vi.fn(),
  signedAgentDeviceRequest: vi.fn(),
}));
vi.mock("./store/useAgentsStore", () => ({ agentsDeviceSnapshot: vi.fn() }));

const { memoryBatch } = await import("./deviceEmbeddings");

const key = { space_id: "work", branch: "moments", record_id: "r", content_hash: "h" };

const answers = (chunks: unknown[]) =>
  fixture.invoke.mockImplementation(async (command: string) =>
    command === "memory_embed_claim" ? chunks : undefined,
  );

const completed = () =>
  fixture.invoke.mock.calls.find(([command]) => command === "memory_embed_complete")?.[1].result;

beforeEach(() => vi.clearAllMocks());

describe("vectors for memory on this computer", () => {
  it("reads what waits from the local store and gives the vectors back", async () => {
    answers([{ ...key, text: "words" }]);
    fixture.embed.mockResolvedValue({ model: "m", embeddings: [[1, 2]] });
    await expect(memoryBatch()).resolves.toBe(60_000);
    expect(fixture.embed).toHaveBeenCalledWith(["words"]);
    expect(completed()).toEqual({ model: "m", chunks: [{ ...key, vector: [1, 2] }] });
  });

  it("carries on at once when a whole batch came back", async () => {
    answers(Array.from({ length: 32 }, () => ({ ...key, text: "words" })));
    fixture.embed.mockResolvedValue({ model: "m", embeddings: Array(32).fill([1]) });
    await expect(memoryBatch()).resolves.toBe(0);
  });

  it("waits with nothing to do, and makes no model call", async () => {
    answers([]);
    await expect(memoryBatch()).resolves.toBe(60_000);
    expect(fixture.embed).not.toHaveBeenCalled();
  });

  it("hands back what it couldn't embed, and asks less often with no model", async () => {
    answers([{ ...key, text: "words" }]);
    fixture.embed.mockRejectedValue(new Error("network"));
    await expect(memoryBatch()).resolves.toBe(60_000);
    expect(completed()).toEqual({ failed: [key] });
    fixture.embed.mockRejectedValue(new ApiRequestError("no key", 400, "model_key_needed"));
    await expect(memoryBatch()).resolves.toBe(600_000);
  });
});
