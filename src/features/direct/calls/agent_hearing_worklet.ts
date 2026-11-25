declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const HEARD_RATE = 16_000;

class AgentHearingProcessor extends AudioWorkletProcessor {
  private step = Math.max(1, sampleRate / HEARD_RATE);
  private due = this.step;
  private sum = 0;
  private count = 0;
  private chunk = new Int16Array(HEARD_RATE / 10);
  private filled = 0;

  process(inputs: Float32Array[][]) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      this.sum += sample;
      this.count += 1;
      this.due -= 1;
      if (this.due > 0) continue;
      this.due += this.step;
      this.keep(this.sum / this.count);
      this.sum = 0;
      this.count = 0;
    }
    return true;
  }

  private keep(sample: number) {
    const clamped = Math.max(-1, Math.min(1, sample));
    this.chunk[this.filled++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    if (this.filled < this.chunk.length) return;
    this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
    this.chunk = new Int16Array(this.chunk.length);
    this.filled = 0;
  }
}

registerProcessor("misty-agent-hearing", AgentHearingProcessor);

export {};
