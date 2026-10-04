/** Native CPAL input becomes a real WebRTC media track, preserving the global
 * shortcut and macOS microphone owner. SDP and control stay on Misty's relay. */
export class CompanionVoiceWebRTC {
  private peer = new RTCPeerConnection();
  private context = new AudioContext();
  private input = this.context.createMediaStreamDestination();
  private speaker = new Audio();
  private sender = this.peer.addTrack(this.input.stream.getAudioTracks()[0], this.input.stream);
  private sources = new Set<AudioBufferSourceNode>();
  private next = 0;
  private closed = false;
  private connected!: () => void;
  private rejected!: (error: Error) => void;
  private connection = new Promise<void>((resolve, reject) => {
    this.connected = resolve;
    this.rejected = reject;
  });
  private timer?: ReturnType<typeof setTimeout>;
  private drainTimer?: ReturnType<typeof setTimeout>;
  private rejectDrain?: (error: Error) => void;

  constructor(private onError: (error: Error) => void) {
    void this.connection.catch(() => {});
    this.peer.createDataChannel("oai-events");
    this.speaker.autoplay = true;
    this.speaker.onerror = () => this.fail("Voice playback failed.");
    this.peer.ontrack = (event) => {
      if (this.closed) return;
      this.speaker.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void this.speaker.play().catch(() => this.fail("Voice playback is unavailable."));
    };
    this.peer.onconnectionstatechange = () => {
      if (this.closed) return;
      if (this.peer.connectionState === "connected") {
        clearTimeout(this.timer);
        this.connected();
      } else if (this.peer.connectionState === "disconnected") {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.fail("The WebRTC media connection stopped."), 2000);
      } else if (["failed", "closed"].includes(this.peer.connectionState)) {
        this.fail("The WebRTC media connection stopped.");
      }
    };
    this.context.onstatechange = () => {
      if (!this.closed && this.context.state === "suspended")
        this.fail("Voice audio processing was suspended.");
    };
  }

  async offer(): Promise<string> {
    await this.context.resume();
    if (this.closed || this.context.state !== "running")
      throw new Error("Voice input is unavailable.");
    await this.peer.setLocalDescription(await this.peer.createOffer());
    if (this.closed || !this.peer.localDescription?.sdp)
      throw new Error("Voice negotiation failed.");
    return this.peer.localDescription.sdp;
  }

  async answer(sdp: string): Promise<void> {
    await this.peer.setRemoteDescription({ type: "answer", sdp });
    if (this.closed) throw new Error("Voice turn cancelled.");
    this.timer = setTimeout(
      () => this.fail("WebRTC could not connect. Trying the voice relay."),
      12_000,
    );
    if (this.peer.connectionState === "connected") {
      clearTimeout(this.timer);
      this.connected();
    }
    return this.connection;
  }

  append(encoded: string) {
    if (this.closed) throw new Error("Voice turn cancelled.");
    const bytes = atob(encoded);
    if (!bytes.length || bytes.length % 2) throw new Error("Invalid microphone audio.");
    const buffer = this.context.createBuffer(1, bytes.length / 2, 24000);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index++) {
      const word = bytes.charCodeAt(index * 2) | (bytes.charCodeAt(index * 2 + 1) << 8);
      samples[index] = (word >= 32768 ? word - 65536 : word) / 32768;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.input);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
    };
    this.sources.add(source);
    // Preserve contiguous microphone samples; only rebuffer after an actual
    // underrun rather than inserting a gap whenever lead falls below 30 ms.
    if (this.next <= this.context.currentTime) this.next = this.context.currentTime + 0.08;
    source.start(this.next);
    this.next += buffer.duration;
  }

  async finishInput() {
    // Control and RTP are separate channels. Drain native samples through the
    // media clock before committing; detach input while keeping remote output.
    await new Promise<void>((resolve, reject) => {
      this.rejectDrain = reject;
      const limit = Date.now() + 65_000;
      const check = () => {
        if (this.closed) return reject(new Error("Voice turn cancelled."));
        if (this.context.state !== "running" || Date.now() > limit)
          return reject(new Error("Voice input stopped making progress."));
        if (this.context.currentTime >= this.next + 0.2) return resolve();
        this.drainTimer = setTimeout(check, 25);
      };
      check();
    });
    this.rejectDrain = undefined;
    await this.sender.replaceTrack(null);
  }

  async finishOutput() {
    // The sideband stopped event means the provider's buffer drained. Allow
    // the receiver's jitter buffer to finish before tearing down its track.
    let tail = 300;
    try {
      const stats = await this.peer.getStats();
      stats.forEach((entry) => {
        if (
          entry.type === "inbound-rtp" &&
          entry.kind === "audio" &&
          entry.jitterBufferEmittedCount > 0
        )
          tail = Math.max(
            tail,
            100 + (1000 * entry.jitterBufferDelay) / entry.jitterBufferEmittedCount,
          );
      });
    } catch {
      /* Closed peers are handled by the owner. */
    }
    if (this.closed) throw new Error("Voice turn cancelled.");
    await new Promise<void>((resolve, reject) => {
      this.rejectDrain = reject;
      this.drainTimer = setTimeout(resolve, Math.min(tail, 2000));
    });
    this.rejectDrain = undefined;
  }

  private fail(message: string) {
    if (this.closed) return;
    const error = new Error(message);
    this.rejected(error);
    this.onError(error);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    clearTimeout(this.drainTimer);
    const error = new Error("Voice turn cancelled.");
    this.rejected(error);
    this.rejectDrain?.(error);
    for (const source of this.sources) {
      source.stop();
      source.disconnect();
    }
    this.sources.clear();
    this.speaker.pause();
    this.speaker.srcObject = null;
    this.input.stream.getTracks().forEach((track) => track.stop());
    this.peer.getReceivers().forEach((receiver) => receiver.track.stop());
    this.peer.close();
    void this.context.close().catch(() => {});
  }
}
