declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class AgentHearingProcessor extends AudioWorkletProcessor {
  private chunk = new Int16Array(Math.round(sampleRate / 10));
  private filled = 0;

  process(inputs: Float32Array[][]) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      const clamped = Math.max(-1, Math.min(1, sample));
      this.chunk[this.filled++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      if (this.filled === this.chunk.length) {
        this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
        this.chunk = new Int16Array(this.chunk.length);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("misty-agent-hearing", AgentHearingProcessor);

export {};
