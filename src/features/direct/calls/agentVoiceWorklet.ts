/**
 * Plays an agent's spoken answer into its call track (`agentVoice.ts`): mono PCM16 at the
 * context's rate, a sentence at a time as it is made. It tells the port `idle` each time it has
 * played everything it was given, and `{ clear: true }` from the port drops what is queued.
 */

declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class AgentVoiceProcessor extends AudioWorkletProcessor {
  private queue: Int16Array[] = [];
  /** How far into the first chunk playing has got. */
  private offset = 0;
  private playing = false;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<ArrayBuffer | { clear: true }>) => {
      if (event.data instanceof ArrayBuffer) {
        this.queue.push(new Int16Array(event.data));
        this.playing = true;
        return;
      }
      this.queue = [];
      this.offset = 0;
      if (this.playing) {
        this.playing = false;
        this.port.postMessage("idle");
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0]?.[0];
    if (!out) return true;
    for (let frame = 0; frame < out.length; frame += 1) {
      const chunk = this.queue[0];
      if (!chunk) {
        out[frame] = 0;
        continue;
      }
      out[frame] = chunk[this.offset] / 32768;
      this.offset += 1;
      if (this.offset >= chunk.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    if (this.playing && this.queue.length === 0) {
      this.playing = false;
      this.port.postMessage("idle");
    }
    return true;
  }
}

registerProcessor("misty-agent-voice", AgentVoiceProcessor);

// A module of its own, so its declarations stay out of the global scope.
export {};
