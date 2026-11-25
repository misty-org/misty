import { Track, type LocalTrackPublication, type Room } from "livekit-client";
import workletUrl from "./agent_voice_worklet.ts?worker&url";
import { speakerSink, type SpeakerSink } from "./speaker_sink";
import { AGENT_VOICE_PREFIX } from "./use_live_kit_call";

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

export class AgentVoice {
  private context?: AudioContext;
  private speaker?: SpeakerSink;
  private node?: AudioWorkletNode;
  private heard?: GainNode;
  private track?: MediaStreamTrack;
  private publication?: LocalTrackPublication;
  private opened?: Promise<void>;
  private closed = false;
  private deaf = false;

  constructor(
    private readonly room: Room | null,
    private readonly agentId: string,
    private readonly onIdle: () => void,
  ) {}

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
      const speaker = speakerSink(context);
      this.speaker = speaker;
      const heard = context.createGain();
      heard.gain.value = this.deaf ? 0 : 1;
      node.connect(heard);
      heard.connect(speaker.destination);
      this.heard = heard;
      await context.resume();
      const [track] = destination.stream.getAudioTracks();
      this.track = track;
      if (this.closed || !this.room) return;
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

  async speak(pcm: string, rate: number) {
    await this.open();
    if (this.closed || !this.node) return;
    const samples = atRate(samplesOf(pcm), rate);
    const copy = samples.slice();
    this.node.port.postMessage(copy.buffer, [copy.buffer]);
  }

  hush() {
    this.node?.port.postMessage({ clear: true });
  }

  deafen(on: boolean) {
    this.deaf = on;
    if (this.heard) this.heard.gain.value = on ? 0 : 1;
  }

  private async unpublish() {
    const publication = this.publication;
    this.publication = undefined;
    if (publication?.track && this.room)
      await this.room.localParticipant.unpublishTrack(publication.track).catch(() => undefined);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.opened?.catch(() => undefined);
    await this.unpublish();
    this.track?.stop();
    this.node?.disconnect();
    this.heard?.disconnect();
    this.speaker?.close();
    await this.context?.close().catch(() => undefined);
  }
}
