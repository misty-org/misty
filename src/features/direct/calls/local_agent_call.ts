import { notify } from "@misty/ui";
import { agentCallGreeting, agentCallTurn, type CallFrame, type CallTurn } from "@/features/agents";
import {
  hear,
  renderSpeech,
  warmVoicebox,
  type HearingEvent,
  type HearingSession,
} from "@/features/voice";
import type { AgentProfile } from "@/shared/schemas";
import { AgentVoice } from "./agent_voice";
import { savedCallAudio, savedCallDevice } from "./call_devices";
import { playCallSound } from "./call_sounds";

export type AgentCallState = "connecting" | "listening" | "thinking" | "speaking" | "working";

export interface AgentCallView {
  state: AgentCallState;
  micOn: boolean;
  hearing: boolean;
  deafened: boolean;
  camera: MediaStream | null;
  screen: MediaStream | null;
}

const ME = "me";
const FRAME_EDGE = 1600;

const chosenCamera = () => savedCallDevice.videoinput.getState().value || undefined;

async function frameOf(stream: MediaStream): Promise<Blob | null> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    await video.play();
    if (!video.videoWidth)
      await new Promise((resolve) => video.addEventListener("loadeddata", resolve, { once: true }));
    const scale = Math.min(1, FRAME_EDGE / Math.max(video.videoWidth, video.videoHeight, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  } catch {
    return null;
  } finally {
    video.pause();
    video.srcObject = null;
  }
}

function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  return typeof error === "string" ? error.trim() : "";
}

export class LocalAgentCall {
  private view: AgentCallView = {
    state: "connecting",
    micOn: !savedCallAudio.getState().value.muted,
    hearing: false,
    deafened: savedCallAudio.getState().value.deafened,
    camera: null,
    screen: null,
  };
  private listeners = new Set<() => void>();
  private session?: HearingSession;
  private listening = 0;
  private voice: AgentVoice;
  private turn?: {
    id: string;
    call: CallTurn;
    greeting: boolean;
    done: boolean;
    making: number;
    chain: Promise<void>;
  };
  private ended = false;
  private deafNotice = false;
  private ready: Promise<void> = Promise.resolve();
  private unwatch: (() => void)[] = [];

  constructor(
    readonly agent: AgentProfile,
    readonly conversationId: string,
    readonly sees: boolean,
    private readonly onEnded: () => void,
  ) {
    this.voice = new AgentVoice(null, agent.id, () => this.played());
    this.voice.deafen(this.view.deafened);
    this.unwatch = [
      savedCallAudio.subscribe((state, previous) => {
        if (state.value.muted !== previous.value.muted) this.applyMic(!state.value.muted);
        if (state.value.deafened !== previous.value.deafened)
          this.applyDeafen(state.value.deafened);
      }),
      savedCallDevice.videoinput.subscribe((state, previous) => {
        if (state.value !== previous.value) void this.retakeCamera();
      }),
    ];
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  current = () => this.view;

  async open(video: boolean) {
    void warmVoicebox().catch(() => undefined);
    this.ready = (async () => {
      await this.voice.open();
      if (this.ended || !this.view.micOn || this.session) return;
      await this.listen();
    })();
    this.ready.catch(() => undefined);
    this.greet();
    try {
      await this.ready;
      if (this.ended) return this.release();
      playCallSound("join");
      this.set({ state: this.turn ? "thinking" : "listening" });
      if (video && this.sees) await this.toggleCamera();
    } catch (error) {
      const reason = reasonOf(error);
      notify({
        message: reason || `The call with ${this.agent.name} couldn’t start.`,
        tone: "error",
      });
      this.end();
    }
  }

  toggleMic = () => {
    const muted = this.view.micOn;
    savedCallAudio.getState().set((current) => ({ ...current, muted }));
  };

  toggleDeafen = () => {
    const deafened = !this.view.deafened;
    savedCallAudio.getState().set((current) => ({ ...current, deafened }));
  };

  private applyMic(on: boolean) {
    if (on === this.view.micOn) return;
    if (this.view.state !== "connecting") playCallSound(on ? "unmute" : "mute");
    this.set(on ? { micOn: on } : { micOn: on, hearing: false });
    if (!on) return this.stopListening();
    void this.listen().catch((error: unknown) => this.unheard(reasonOf(error)));
  }

  private applyDeafen(on: boolean) {
    if (on === this.view.deafened) return;
    this.voice.deafen(on);
    if (this.view.state !== "connecting") playCallSound(on ? "mute" : "unmute");
    this.set({ deafened: on });
  }

  private async listen() {
    const generation = ++this.listening;
    const current = () => !this.ended && generation === this.listening;
    const session = await hear((event) => {
      if (current()) this.heardEvent(event);
    });
    try {
      if (current()) await session.mic(ME);
    } catch (error) {
      await session.stop().catch(() => undefined);
      throw error;
    }
    if (!current()) return void session.stop().catch(() => undefined);
    this.session = session;
  }

  private stopListening() {
    this.listening += 1;
    const session = this.session;
    this.session = undefined;
    void session?.stop().catch(() => undefined);
  }

  private async retakeCamera() {
    if (this.ended || !this.view.camera) return;
    for (const track of this.view.camera.getTracks()) track.stop();
    this.set({ camera: null });
    await this.toggleCamera();
  }

  toggleCamera = async () => {
    if (this.view.camera) {
      for (const track of this.view.camera.getTracks()) track.stop();
      this.set({ camera: null });
      return;
    }
    if (!this.sees) return;
    try {
      const camera = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: chosenCamera() },
      });
      if (this.ended) return void camera.getTracks().forEach((track) => track.stop());
      this.set({ camera });
    } catch {
      notify({ message: "Your camera couldn’t be turned on.", tone: "error" });
    }
  };

  toggleScreen = async () => {
    if (this.view.screen) {
      for (const track of this.view.screen.getTracks()) track.stop();
      this.set({ screen: null });
      return;
    }
    if (!this.sees) return;
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (this.ended) return void screen.getTracks().forEach((track) => track.stop());
      screen.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (this.view.screen === screen) this.set({ screen: null });
      });
      this.set({ screen });
    } catch {}
  };

  stopTurn = () => {
    if (!this.turn) return;
    this.turn.call.stop();
    this.turn = undefined;
    this.voice.hush();
    this.set({ state: "listening" });
  };

  end = () => {
    if (this.ended) return;
    this.ended = true;
    for (const unwatch of this.unwatch) unwatch();
    this.unwatch = [];
    this.turn?.call.stop();
    this.turn = undefined;
    this.release();
    playCallSound("leave");
    this.onEnded();
    this.listeners.clear();
  };

  private release() {
    this.stopListening();
    for (const stream of [this.view.camera, this.view.screen])
      for (const track of stream?.getTracks() ?? []) track.stop();
    this.voice.hush();
    void this.voice.close();
  }

  private set(change: Partial<AgentCallView>) {
    const spoke = this.view.state === "speaking" && change.state && change.state !== "speaking";
    this.view = { ...this.view, ...change };
    if (spoke) this.session?.reset(ME);
    for (const listener of this.listeners) listener();
  }

  private unheard(error: string) {
    if (this.deafNotice) return;
    this.deafNotice = true;
    notify({
      message: error.trim() || `${this.agent.name} can’t hear you in this call.`,
      tone: "error",
    });
  }

  private heardEvent(event: HearingEvent) {
    if (event.kind === "failed") return this.unheard(event.error);
    if (this.view.state === "speaking") {
      if (this.view.hearing) this.set({ hearing: false });
      return;
    }
    if (event.kind === "started") this.set({ hearing: true });
    else if (event.kind === "stopped") this.set({ hearing: false });
    else if (event.kind === "heard" && event.text.trim()) this.said(event.text);
  }

  private said(text: string) {
    if (this.turn?.greeting && this.view.state === "thinking") {
      this.turn.call.stop();
      this.turn = undefined;
      this.set({ state: "listening" });
    }
    if (this.view.state !== "listening") return;
    void this.answer(text);
  }

  private greet() {
    const id = crypto.randomUUID();
    const call = agentCallGreeting(this.agent, "alone", {
      conversationId: this.conversationId,
      onSentence: (sentence) => this.speak(id, sentence),
    });
    this.follow(id, call, true);
  }

  private async frames(): Promise<CallFrame[]> {
    const taken: CallFrame[] = [];
    for (const [of, stream] of [
      ["screen", this.view.screen],
      ["camera", this.view.camera],
    ] as const) {
      if (!stream) continue;
      const picture = await frameOf(stream);
      if (picture) taken.push({ picture, of });
    }
    return taken;
  }

  private async answer(said: string) {
    const id = crypto.randomUUID();
    this.set({ state: "thinking" });
    const frames = this.sees ? await this.frames() : [];
    if (this.ended || this.view.state !== "thinking") return;
    const call = agentCallTurn(this.agent, said, {
      conversationId: this.conversationId,
      frames,
      onSentence: (sentence) => this.speak(id, sentence),
    });
    this.follow(id, call, false);
  }

  private follow(id: string, call: CallTurn, greeting: boolean) {
    this.turn = { id, call, greeting, done: false, making: 0, chain: Promise.resolve() };
    call.finished
      .catch((reason: unknown) => {
        if (this.turn?.id !== id) return;
        notify({
          message:
            reason instanceof Error ? reason.message : `${this.agent.name} couldn’t finish that.`,
          tone: "error",
        });
      })
      .finally(() => {
        const turn = this.turn;
        if (turn?.id !== id) return;
        turn.done = true;
        void turn.chain.then(() => {
          if (this.turn?.id === id && this.view.state !== "speaking") this.caughtUp(id);
        });
      });
  }

  private speak(id: string, sentence: string) {
    const turn = this.turn;
    if (!turn || turn.id !== id) return;
    turn.making += 1;
    const made = renderSpeech(sentence, this.agent.voice || undefined);
    turn.chain = turn.chain
      .then(async () => {
        const speech = await made;
        const opened = await this.ready.then(
          () => true,
          () => false,
        );
        if (!opened || this.ended || this.turn?.id !== id) return;
        await this.voice.speak(speech.pcm, speech.rate);
        this.set({ state: "speaking" });
      })
      .catch(() => {
        if (this.turn?.id === id)
          notify({ message: `${this.agent.name} couldn’t speak that.`, tone: "error" });
      })
      .finally(() => {
        if (this.turn?.id === id) turn.making -= 1;
      });
  }

  private played() {
    const turn = this.turn;
    if (!turn || turn.making > 0) return;
    this.caughtUp(turn.id);
  }

  private caughtUp(id: string) {
    if (!this.turn || this.turn.id !== id) return;
    const connecting = this.view.state === "connecting";
    if (!this.turn.done) return connecting ? undefined : this.set({ state: "working" });
    this.turn = undefined;
    if (!connecting) this.set({ state: "listening" });
  }
}
