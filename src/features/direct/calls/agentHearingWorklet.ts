/**
 * Turns the person's call microphone into what the speech recognizer takes: mono PCM16 at the
 * context's rate (16 kHz, `agentHearing.ts`), in chunks of about 100ms posted to the port.
 */

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

// A module of its own, so its declarations stay out of the global scope.
export {};
