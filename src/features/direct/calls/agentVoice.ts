import { Track, type LocalTrackPublication, type Room } from "livekit-client";
import workletUrl from "./agentVoiceWorklet.ts?worker&url";
import { AGENT_VOICE_PREFIX } from "./useLiveKitCall";

/** Misty's voices speak at 24 kHz (Kokoro); anything else is resampled to it. */
const RATE = 24_000;

function samplesOf(pcm: string): Int16Array {
  const binary = atob(pcm);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
}

function atRate(samples: Int16Array, from: number): Int16Array {
  if (from === RATE || from <= 0 || samples.length === 0) return samples;
  const ratio = from / RATE;
  const length = Math.floor(samples.length / ratio);
  const out = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    const fraction = position - left;
    out[index] = Math.round(samples[left] * (1 - fraction) + samples[right] * fraction);
  }
  return out;
}

/**
 * An agent's voice in a call: its person's computer speaks each sentence once, in the agent's
 * voice, and plays it into an audio track of its own, published into the call and end-to-end
 * encrypted like every other. Everyone hears the same voice through the call; its person hears
 * it through the page too, so the call's echo cancelling knows it and the microphone never sends
 * it back.
 */
export class AgentVoice {
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private track?: MediaStreamTrack;
  private publication?: LocalTrackPublication;
  private opened?: Promise<void>;
  private closed = false;

  constructor(
    private readonly room: Room,
    private readonly agentId: string,
    /** Runs each time everything handed to it has been played. */
    private readonly onIdle: () => void,
  ) {}

  /** Opens the voice's track and publishes it; settles once it's in the call. */
  open(): Promise<void> {
    this.opened ??= (async () => {
      const context = new AudioContext({ sampleRate: RATE, latencyHint: "interactive" });
      this.context = context;
      await context.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(context, "misty-agent-voice", {
        numberOfInputs: 0,
        outputChannelCount: [1],
      });
      this.node = node;
      node.port.onmessage = (event: MessageEvent) => {
        if (event.data === "idle" && !this.closed) this.onIdle();
      };
      const destination = context.createMediaStreamDestination();
      destination.channelCount = 1;
      node.connect(destination);
      // Heard here too, through the page, where the call's echo cancelling hears it.
      node.connect(context.destination);
      await context.resume();
      const [track] = destination.stream.getAudioTracks();
      this.track = track;
      if (this.closed) return;
      this.publication = await this.room.localParticipant.publishTrack(track, {
        name: `${AGENT_VOICE_PREFIX}${this.agentId}`,
        source: Track.Source.Unknown,
        dtx: false,
        red: false,
      });
      if (this.closed) await this.unpublish();
    })();
    return this.opened;
  }

  /** Plays one sentence: mono PCM16 little-endian as base64, at `rate`. */
  async speak(pcm: string, rate: number) {
    await this.open();
    if (this.closed || !this.node) return;
    const samples = atRate(samplesOf(pcm), rate);
    const copy = samples.slice();
    this.node.port.postMessage(copy.buffer, [copy.buffer]);
  }

  /** Stops what it's saying and drops what is queued. */
  hush() {
    this.node?.port.postMessage({ clear: true });
  }

  private async unpublish() {
    const publication = this.publication;
    this.publication = undefined;
    if (publication?.track)
      await this.room.localParticipant.unpublishTrack(publication.track).catch(() => undefined);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.opened?.catch(() => undefined);
    await this.unpublish();
    this.track?.stop();
    this.node?.disconnect();
    await this.context?.close().catch(() => undefined);
  }
}
