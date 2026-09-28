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
