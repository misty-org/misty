import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CompanionVoicePlayback } from "./companionVoicePlayback";

class FixtureContext {
  static instances: FixtureContext[] = [];
  state = "running";
  currentTime = 0;
  destination = {};
  buffers: Float32Array[] = [];
  sources: {
    onended: (() => void) | null;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  constructor() {
    FixtureContext.instances.push(this);
  }
  resume = async () => {};
  close = async () => {
    this.state = "closed";
  };
  createBuffer(_channels: number, count: number, rate: number) {
    const data = new Float32Array(count);
    this.buffers.push(data);
    return { duration: count / rate, getChannelData: () => data };
  }
  createBufferSource() {
    const source = {
      buffer: {},
      onended: null as (() => void) | null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    this.sources.push(source);
    return source;
  }
}
let players: CompanionVoicePlayback[] = [];
beforeEach(() => {
  FixtureContext.instances = [];
  vi.stubGlobal("AudioContext", FixtureContext);
});
afterEach(() => {
  players.forEach((player) => player.close());
  players = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function fixture() {
  const playing = vi.fn(),
    done = vi.fn(),
    error = vi.fn();
  const player = new CompanionVoicePlayback(playing, done, error);
  players.push(player);
  return { player, context: FixtureContext.instances[0], playing, done, error };
}

it("decodes signed PCM and schedules chunks without overlap", async () => {
  const { player, context, done } = fixture();
  await player.start();
  player.append(btoa(String.fromCharCode(0, 0, 255, 127, 0, 128, 255, 255)));
  player.append(btoa(String.fromCharCode(0, 0)));
  expect(Array.from(context.buffers[0])).toEqual([0, 32767 / 32768, -1, -1 / 32768]);
  expect(context.sources[1].start.mock.calls[0][0]).toBeGreaterThan(
    context.sources[0].start.mock.calls[0][0],
  );
  player.finish();
  expect(done).not.toHaveBeenCalled();
  context.sources[0].onended?.();
  expect(done).not.toHaveBeenCalled();
  context.sources[1].onended?.();
  expect(done).toHaveBeenCalledOnce();
});
it("keeps bursty network audio contiguous and publishes playing only once", async () => {
  const { player, context, playing } = fixture();
  await player.start();
  const pcm = btoa("\0".repeat(4800)); // 100 ms at 24 kHz
  player.append(pcm);
  const firstStart = context.sources[0].start.mock.calls[0][0];
  expect(firstStart).toBeGreaterThanOrEqual(0.2);
  // A delayed packet arrives only 10 ms before the prior packet ends.
  // It must follow that packet exactly, not add another 30 ms scheduling pad.
  context.currentTime = firstStart + 0.09;
  player.append(pcm);
  expect(context.sources[1].start.mock.calls[0][0]).toBeCloseTo(firstStart + 0.1, 8);
  context.currentTime += 0.1;
  player.append(pcm);
  expect(context.sources[2].start.mock.calls[0][0]).toBeCloseTo(firstStart + 0.2, 8);
  expect(playing).toHaveBeenCalledOnce();
});
it("rebuilds its jitter cushion after starvation and cancels buffered audio", async () => {
  const { player, context, playing } = fixture();
  await player.start();
  const pcm = btoa("\0".repeat(4800));
  player.append(pcm);
  context.currentTime = 2;
  player.append(pcm);
  const resumed = context.sources[1].start.mock.calls[0][0];
  expect(resumed - context.currentTime).toBeGreaterThan(0.25);
  context.currentTime = resumed + 0.09;
  player.append(pcm);
  expect(context.sources[2].start.mock.calls[0][0]).toBeCloseTo(resumed + 0.1, 8);
  player.close();
  expect(playing).toHaveBeenCalledOnce();
  for (const source of context.sources) expect(source.stop).toHaveBeenCalledOnce();
  expect(() => player.append(pcm)).toThrow("cancelled");
});
it("stops all queued audio and detaches late completion on cancellation", async () => {
  const { player, context, done } = fixture();
  await player.start();
  player.append("AAAAAA==");
  player.close();
  expect(context.sources[0].stop).toHaveBeenCalledOnce();
  expect(context.sources[0].onended).toBeNull();
  expect(context.state).toBe("closed");
  expect(done).not.toHaveBeenCalled();
});

it("reports only played samples for provider truncation, excluding buffering delays", async () => {
  const { player, context } = fixture();
  await player.start();
  player.append(btoa("\0".repeat(4800)), "first");
  context.currentTime = 0.29;
  expect(player.heard()).toEqual({ itemId: "first", audioEndMs: 39 });
  player.append(btoa("\0".repeat(4800)), "second");
  expect(player.heard()).toEqual({ itemId: "second", audioEndMs: 0 });
  context.currentTime = 0.4;
  expect(player.heard().audioEndMs).toBeGreaterThanOrEqual(50);
});
it("rejects invalid PCM, empty output and audio after completion", async () => {
  const { player } = fixture();
  await player.start();
  expect(() => player.append("AA==")).toThrow("invalid");
  expect(() => player.finish()).toThrow("no audio");
  expect(() => player.append("AAAAAA==")).toThrow("completed");
});
it("detects a suspended playback clock instead of hanging", async () => {
  vi.useFakeTimers();
  const { player, error } = fixture();
  await player.start();
  player.append("AAAAAA==");
  await vi.advanceTimersByTimeAsync(23_000);
  expect(error).toHaveBeenCalled();
});
it("fails if completion events are lost after the scheduled audio ends", async () => {
  vi.useFakeTimers();
  const { player, context, error } = fixture();
  await player.start();
  player.append("AAAAAA==");
  player.finish();
  context.currentTime = 10;
  await vi.advanceTimersByTimeAsync(1000);
  expect(error).toHaveBeenCalledOnce();
});
