/** Bounded 24 kHz signed PCM playback. No provider data or audio is persisted. */
export class CompanionVoicePlayback {
  private context = new AudioContext({ sampleRate: 24000 });
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private bytes = 0;
  private complete = false;
  private timer?: ReturnType<typeof setInterval>;
  private lastProgress = 0;
  private lastTime = -1;

  constructor(
    private onPlaying: () => void,
    private onDone: () => void,
    private onError: (error: Error) => void,
  ) {}

  async start() {
    await this.context.resume();
    if (this.context.state !== "running") throw new Error("Audio playback is unavailable.");
    this.lastProgress = Date.now();
    this.timer = setInterval(() => {
      if (!this.sources.size) return;
      if (this.complete && this.context.currentTime > this.nextTime + 2) {
        this.onError(new Error("Audio playback did not finish."));
        return;
      }
      if (this.context.currentTime > this.lastTime) {
        this.lastTime = this.context.currentTime;
        this.lastProgress = Date.now();
      } else if (Date.now() - this.lastProgress > 20_000) {
        this.onError(new Error("Audio playback stopped making progress."));
      }
    }, 1000);
  }

  append(encoded: string) {
    if (this.complete) throw new Error("Audio arrived after playback completed.");
    const raw = atob(encoded);
    if (!raw.length || raw.length % 2 || this.bytes + raw.length > 24000 * 2 * 120)
      throw new Error("Voice audio is invalid or too long.");
    this.bytes += raw.length;
    const buffer = this.context.createBuffer(1, raw.length / 2, 24000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) {
      let value = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
      if (value >= 32768) value -= 65536;
      channel[i] = value / 32768;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
      if (this.complete && !this.sources.size) this.onDone();
    };
    this.sources.add(source);
    this.nextTime = Math.max(this.nextTime, this.context.currentTime + 0.03);
    source.start(this.nextTime);
    this.nextTime += buffer.duration;
    this.onPlaying();
  }

  finish() {
    this.complete = true;
    if (!this.bytes) throw new Error("The voice provider returned no audio.");
    if (!this.sources.size) this.onDone();
  }

  close() {
    clearInterval(this.timer);
    for (const source of this.sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.sources.clear();
    void this.context.close().catch(() => {});
  }
}
