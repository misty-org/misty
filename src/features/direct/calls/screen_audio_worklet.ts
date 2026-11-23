declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const START_SECONDS = 0.06;
const MOST_SECONDS = 0.25;

class ScreenAudioProcessor extends AudioWorkletProcessor {
  private queue: Int16Array[] = [];
  private offset = 0;
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

export {};
