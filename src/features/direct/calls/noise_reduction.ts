import type { AudioProcessorOptions, LocalAudioTrack, Track, TrackProcessor } from "livekit-client";
import type * as Suppressor from "@sapphi-red/web-noise-suppressor";
import workletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import wasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import simdUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";

let suppressor: Promise<typeof Suppressor> | undefined;
let binary: Promise<ArrayBuffer> | undefined;
let context: AudioContext | undefined;
const loaded = new WeakMap<AudioContext, Promise<void>>();

function library() {
  suppressor ??= import("@sapphi-red/web-noise-suppressor").catch((error: unknown) => {
    suppressor = undefined;
    throw error;
  });
  return suppressor;
}

function rnnoise() {
  binary ??= library()
    .then(({ loadRnnoise }) => loadRnnoise({ url: wasmUrl, simdUrl }))
    .catch((error: unknown) => {
      binary = undefined;
      throw error;
    });
  return binary;
}

function audioContext() {
  if (!context || context.state === "closed") context = new AudioContext({ sampleRate: 48_000 });
  return context;
}

function worklet(on: AudioContext) {
  let module = loaded.get(on);
  if (!module) {
    module = on.audioWorklet.addModule(workletUrl);
    module.catch(() => loaded.delete(on));
    loaded.set(on, module);
  }
  return module;
}

class NoiseReduction implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = "misty-noise-reduction";
  processedTrack?: MediaStreamTrack;
  private node?: Suppressor.RnnoiseWorkletNode;
  private source?: MediaStreamAudioSourceNode;

  async init({ track, audioContext: on }: AudioProcessorOptions) {
    const [{ RnnoiseWorkletNode }, wasmBinary] = await Promise.all([
      library(),
      rnnoise(),
      worklet(on),
    ]);
    const source = on.createMediaStreamSource(new MediaStream([track]));
    const node = new RnnoiseWorkletNode(on, { maxChannels: 1, wasmBinary });
    const out = on.createMediaStreamDestination();
    source.connect(node).connect(out);
    await on.resume();
    this.source = source;
    this.node = node;
    this.processedTrack = out.stream.getAudioTracks()[0];
  }

  async restart(options: AudioProcessorOptions) {
    await this.destroy();
    await this.init(options);
  }

  async destroy() {
    this.source?.disconnect();
    this.source = undefined;
    this.node?.disconnect();
    this.node?.destroy();
    this.node = undefined;
    this.processedTrack?.stop();
    this.processedTrack = undefined;
  }
}

export async function applyNoiseReduction(track: LocalAudioTrack, on: boolean) {
  const running = track.getProcessor()?.name === "misty-noise-reduction";
  if (on === running) return;
  if (!on) return track.stopProcessor();
  track.setAudioContext(audioContext());
  await track.setProcessor(new NoiseReduction());
}
