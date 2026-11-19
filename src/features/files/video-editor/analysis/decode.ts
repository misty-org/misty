import {
  ALL_FORMATS,
  AudioBufferSink,
  BlobSource,
  CanvasSink,
  Input,
  type InputVideoTrack,
} from "mediabunny";
import { AudioFeatureStream, type AudioFeatures } from "./audioFeatures";
import { frameFeatures, type FrameFeatures } from "./scenes";

/*
 * Reading a media file for its analysis, in the webview: mediabunny decodes it with the
 * computer's own decoders (WebCodecs), and Web Audio decodes a sound file mediabunny can't.
 */

/** About the sample rate sound is measured at: ample for loudness and beats. */
const MEASURE_RATE = 11025;
/** The largest sound file decoded whole by Web Audio when mediabunny can't stream it. */
const MAX_WHOLE_DECODE_BYTES = 48 * 1024 * 1024;
/** The longest gap in a file's sound filled with silence, in seconds. */
const MAX_GAP = 60;
/** The small frames compared for cuts, and the picture shown to the image classifier. */
export const FRAME_WIDTH = 64;
export const FRAME_HEIGHT = 36;
const PICTURE_WIDTH = 384;

export function stopIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new Error("The analysis was stopped.");
}

/** Mono sound at a whole fraction of its rate: each output sample averages `factor` inputs. */
class Downsampler {
  private sum = 0;
  private count = 0;
  constructor(readonly factor: number) {}
  push(channels: Float32Array[], length: number): Float32Array {
    const out = new Float32Array(Math.floor((this.count + length) / this.factor));
    let written = 0;
    const share = 1 / (channels.length * this.factor);
    for (let i = 0; i < length; i++) {
      for (const channel of channels) this.sum += channel[i];
      if (++this.count === this.factor) {
        out[written++] = this.sum * share;
        this.sum = 0;
        this.count = 0;
      }
    }
    return written === out.length ? out : out.subarray(0, written);
  }
}

/** Measures sound handed over as AudioBuffers, laid at their times in the file. */
class Measurer {
  private stream: AudioFeatureStream | null = null;
  private downsampler: Downsampler | null = null;
  private at = 0;

  push(buffer: AudioBuffer, timestamp: number) {
    if (!this.stream || !this.downsampler) {
      const factor = Math.max(1, Math.round(buffer.sampleRate / MEASURE_RATE));
      this.downsampler = new Downsampler(factor);
      this.stream = new AudioFeatureStream(buffer.sampleRate / factor);
    }
    const gap = Math.min(MAX_GAP, timestamp - this.at);
    if (gap > 1 / this.stream.sampleRate)
      this.stream.push(new Float32Array(Math.round(gap * this.stream.sampleRate)));
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) =>
      buffer.getChannelData(index),
    );
    this.stream.push(this.downsampler.push(channels, buffer.length));
    this.at = Math.max(this.at, timestamp) + buffer.duration;
  }

  finish(): AudioFeatures | null {
    return this.stream?.finish() ?? null;
  }
}

async function measureWhole(file: File, signal?: AbortSignal): Promise<AudioFeatures | null> {
  if (file.size > MAX_WHOLE_DECODE_BYTES || typeof OfflineAudioContext === "undefined") return null;
  const context = new OfflineAudioContext(1, 1, 44100);
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    return null;
  }
  stopIfAborted(signal);
  const measurer = new Measurer();
  measurer.push(decoded, 0);
  return measurer.finish();
}

/** The file's sound measured as it decodes, or null when it has none this computer can read. */
export async function measureAudio(
  file: File,
  signal?: AbortSignal,
): Promise<AudioFeatures | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack().catch(() => null);
    if (!track) return file.type.startsWith("audio/") ? measureWhole(file, signal) : null;
    if (!(await track.canDecode())) return measureWhole(file, signal);
    const measurer = new Measurer();
    const start = await track.getFirstTimestamp().catch(() => 0);
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) {
      stopIfAborted(signal);
      measurer.push(buffer, Math.max(0, timestamp - Math.min(0, start)));
    }
    return measurer.finish();
  } finally {
    input.dispose();
  }
}

function drawingSurface(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The video's frames can't be read here.");
  return { canvas, context };
}

/** A video file's picture, open for reading frames at chosen times. */
export class VideoReader {
  private constructor(
    private readonly input: Input,
    private readonly track: InputVideoTrack,
    readonly duration: number,
  ) {}

  /** The file's picture, or null when it has none this computer can decode. */
  static async open(file: File): Promise<VideoReader | null> {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (track && (await track.canDecode())) {
        const duration = await input.computeDuration();
        if (duration > 0) return new VideoReader(input, track, duration);
      }
    } catch {
      // Not a video this computer reads: no picture to analyse.
    }
    input.dispose();
    return null;
  }

  get width() {
    return this.track.displayWidth;
  }

  get height() {
    return this.track.displayHeight;
  }

  /** The small frame at each time (sorted), or null where there is none. */
  async *framesAt(times: number[]): AsyncGenerator<FrameFeatures | null> {
    if (!times.length) return;
    const sink = new CanvasSink(this.track, {
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      fit: "fill",
      poolSize: 2,
    });
    const { context } = drawingSurface(FRAME_WIDTH, FRAME_HEIGHT);
    for await (const wrapped of sink.canvasesAtTimestamps(times)) {
      if (!wrapped) {
        yield null;
        continue;
      }
      context.drawImage(wrapped.canvas, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
      const { data } = context.getImageData(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
      yield frameFeatures(data, FRAME_WIDTH, FRAME_HEIGHT);
    }
  }

  /** The picture at each time (sorted) as a JPEG, or null where there is none. */
  async *picturesAt(times: number[]): AsyncGenerator<Uint8Array | null> {
    if (!times.length) return;
    const sink = new CanvasSink(this.track, { width: PICTURE_WIDTH, poolSize: 1 });
    for await (const wrapped of sink.canvasesAtTimestamps(times)) {
      if (!wrapped) {
        yield null;
        continue;
      }
      const { canvas, context } = drawingSurface(wrapped.canvas.width, wrapped.canvas.height);
      context.drawImage(wrapped.canvas, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.85),
      );
      yield blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    }
  }

  close() {
    this.input.dispose();
  }
}
