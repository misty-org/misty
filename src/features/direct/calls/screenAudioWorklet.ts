/**
 * Turns the shared screen's sound, as it arrives from native code (48 kHz stereo PCM16,
 * interleaved, in chunks of about 20ms), into the audio of a track. It keeps a short queue so
 * chunks arriving unevenly still play smoothly, and drops the oldest sound once the queue runs
 * long, so the screen's sound never drifts behind its picture.
 */

declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

/** Playing starts once this much is queued, and starts again from here after running dry. */
const START_SECONDS = 0.06;
/** Past this much queued, the oldest is dropped back to the start length. */
const MOST_SECONDS = 0.25;

class ScreenAudioProcessor extends AudioWorkletProcessor {
  private queue: Int16Array[] = [];
  /** How far into the first chunk playing has got, in samples. */
  private offset = 0;
  /** Samples queued, counting both channels. */
  private queued = 0;
  private playing = false;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      const chunk = new Int16Array(event.data);
      this.queue.push(chunk);
      this.queued += chunk.length;
      const most = MOST_SECONDS * sampleRate * 2;
      if (this.queued > most) this.drop(this.queued - START_SECONDS * sampleRate * 2);
    };
  }

  /** Drops the oldest `count` samples (rounded to whole frames). */
  private drop(count: number) {
    let left = count - (count % 2);
    while (left > 0 && this.queue.length) {
      const first = this.queue[0];
      const there = first.length - this.offset;
      if (there <= left) {
        this.queue.shift();
        this.offset = 0;
        this.queued -= there;
        left -= there;
      } else {
        this.offset += left;
        this.queued -= left;
        left = 0;
      }
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const [left, right] = outputs[0];
    if (!left) return true;
    const frames = left.length;
    if (!this.playing) {
      if (this.queued < START_SECONDS * sampleRate * 2) return true;
      this.playing = true;
    }
    for (let frame = 0; frame < frames; frame += 1) {
      const chunk = this.queue[0];
      if (!chunk) {
        // Ran dry: silence until the queue fills again.
        this.playing = false;
        break;
      }
      left[frame] = chunk[this.offset] / 32768;
      if (right) right[frame] = chunk[this.offset + 1] / 32768;
      this.offset += 2;
      this.queued -= 2;
      if (this.offset >= chunk.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("misty-screen-audio", ScreenAudioProcessor);

// A module of its own, so its declarations stay out of the global scope.
export {};
