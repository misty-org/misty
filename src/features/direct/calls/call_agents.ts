import {
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type Room,
} from "livekit-client";
import { notify } from "@misty/ui";
import { agentCallTurn, type CallTurn } from "@/features/agents";
import { hear, matchVocative, renderSpeech, type HearingSession } from "@/features/voice";
import type { AgentProfile } from "@/shared/schemas";
import { tapVoice } from "./agent_hearing";
import { AgentVoice } from "./agent_voice";
import { decoder, encoder, readMessage, topic, type Message } from "./call_agent_messages";
import { playCallSound } from "./call_sounds";

export type CallAgentState = "listening" | "thinking" | "speaking" | "working";

export interface CallAgentView {
  key: string;
  name: string;
  owner: string;
  mine: boolean;
  state: CallAgentState;
  profile?: AgentProfile;
}

const FOLLOW_UP_MS = 8_000;

const voiceOf = (profile: AgentProfile) => profile.voice || undefined;

interface Own {
  profile: AgentProfile;
  state: CallAgentState;
  voice: AgentVoice;
  turn?: {
    id: string;
    call: CallTurn;
    asker: string;
    done: boolean;
    making: number;
    chain: Promise<void>;
  };
}

interface Remote {
  name: string;
  owner: string;
  state: CallAgentState;
}

export class CallAgents {
  private own = new Map<string, Own>();
  private remote = new Map<string, Remote>();
  private session?: Promise<HearingSession | undefined>;
  private taps = new Map<
    string,
    { track: MediaStreamTrack; stop: Promise<(() => void) | undefined> }
  >();
  private lastSpoke?: { id: string; asker: string; until: number };
  private cipher: Promise<CryptoKey>;
  private listeners = new Set<() => void>();
  private snapshot: CallAgentView[] = [];
  private disposed = false;
  others = 0;
  nameOf: (identity: string) => string = (identity) => identity;

  constructor(
    private readonly room: Room,
    key: Uint8Array<ArrayBuffer>,
  ) {
    this.cipher = crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
    room.on(RoomEvent.DataReceived, this.received);
    room.on(RoomEvent.ParticipantConnected, this.joined);
    room.on(RoomEvent.ParticipantDisconnected, this.departed);
    room.on(RoomEvent.LocalTrackPublished, this.micChanged);
    room.on(RoomEvent.TrackSubscribed, this.trackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, this.trackUnsubscribed);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  agents = () => this.snapshot;

  toggle(profile: AgentProfile) {
    if (this.own.has(profile.id)) this.remove(profile.id);
    else this.bring(profile);
  }

  bring(profile: AgentProfile) {
    if (this.disposed || this.own.has(profile.id)) return;
    const id = profile.id;
    const voice = new AgentVoice(this.room, id, () => this.played(id));
    this.own.set(id, { profile, state: "listening", voice });
    void voice.open().catch(() => {
      notify({ message: `${profile.name}’s voice couldn’t join the call.`, tone: "error" });
    });
    playCallSound("join");
    this.announce(id);
    this.hearEveryone();
    this.changed();
  }

  remove(id: string) {
    const own = this.own.get(id);
    if (!own) return;
    own.turn?.call.stop();
    own.voice.hush();
    void own.voice.close();
    this.own.delete(id);
    void this.send({ t: "left", id });
    playCallSound("leave");
    if (!this.own.size) this.deafenAll();
    this.changed();
  }

  stopTurn(id: string) {
    const own = this.own.get(id);
    if (!own?.turn) return;
    own.turn.call.stop();
    own.turn = undefined;
    own.voice.hush();
    this.setState(id, "listening");
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const [id, own] of this.own) {
      own.turn?.call.stop();
      void own.voice.close();
      void this.send({ t: "left", id });
    }
    this.own.clear();
    this.remote.clear();
    this.deafenAll();
    this.room.off(RoomEvent.DataReceived, this.received);
    this.room.off(RoomEvent.ParticipantConnected, this.joined);
    this.room.off(RoomEvent.ParticipantDisconnected, this.departed);
    this.room.off(RoomEvent.LocalTrackPublished, this.micChanged);
    this.room.off(RoomEvent.TrackSubscribed, this.trackSubscribed);
    this.room.off(RoomEvent.TrackUnsubscribed, this.trackUnsubscribed);
    this.listeners.clear();
  }

  private hearing(): Promise<HearingSession | undefined> {
    this.session ??= hear((event) => {
      if (this.disposed) return;
      if (event.kind === "started") this.interrupted(event.input);
      else if (event.kind === "heard" && event.text.trim()) this.said(event.text, event.input);
    }).catch((error: unknown) => {
      notify({
        message:
          error instanceof Error ? error.message : "Your agent couldn’t listen in this call.",
        tone: "error",
      });
      this.session = undefined;
      return undefined;
    });
    return this.session;
  }

  private hearEveryone() {
    const me = this.room.localParticipant;
    const mine = me.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
    if (mine) this.hear(me.identity, mine);
    for (const participant of this.room.remoteParticipants.values()) {
      const track = participant.getTrackPublication(Track.Source.Microphone)?.track
        ?.mediaStreamTrack;
      if (track) this.hear(participant.identity, track);
    }
  }

  private hear(identity: string, track: MediaStreamTrack) {
    if (this.disposed || !this.own.size) return;
    const current = this.taps.get(identity);
    if (current?.track === track) return;
    if (current) this.stopHearing(identity);
    const stop = this.hearing().then(async (session) => {
      if (!session) return undefined;
      return tapVoice(track, (pcm) => session.push(identity, pcm)).catch(() => {
        if (identity === this.room.localParticipant.identity)
          notify({ message: "Your agent couldn’t listen to your microphone.", tone: "error" });
        return undefined;
      });
    });
    this.taps.set(identity, { track, stop });
  }

  private stopHearing(identity: string) {
    const current = this.taps.get(identity);
    this.taps.delete(identity);
    void current?.stop.then((stop) => stop?.());
    void this.session?.then((session) => session?.remove(identity));
  }

  private deafenAll() {
    for (const identity of [...this.taps.keys()]) this.stopHearing(identity);
    const session = this.session;
    this.session = undefined;
    void session?.then((open) => open?.stop()).catch(() => undefined);
  }

  private micChanged = (publication: LocalTrackPublication) => {
    const track = publication.track?.mediaStreamTrack;
    if (publication.source === Track.Source.Microphone && track)
      this.hear(this.room.localParticipant.identity, track);
  };

  private trackSubscribed = (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => {
    if (publication.source === Track.Source.Microphone)
      this.hear(participant.identity, track.mediaStreamTrack);
  };

  private trackUnsubscribed = (
    _track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => {
    if (publication.source === Track.Source.Microphone) this.stopHearing(participant.identity);
  };

  private interrupted(speaker: string) {
    for (const [id, own] of this.own)
      if (own.state === "speaking" && own.turn?.asker === speaker) this.stopTurn(id);
  }

  private said(text: string, speaker: string) {
    const me = this.room.localParticipant.identity;
    const free = [...this.own.values()].filter((own) => own.state === "listening");
    const profiles = free.map((own) => own.profile);
    const named = matchVocative(text, profiles) ?? matchVocative(`hey ${text}`, profiles);
    if (named) {
      const own = this.own.get(named.agent.id);
      if (own) this.answer(own, named.message, speaker);
      return;
    }
    const last = this.lastSpoke && this.own.get(this.lastSpoke.id);
    if (!last || last.state !== "listening") return;
    const followUp = this.lastSpoke?.asker === speaker && Date.now() < (this.lastSpoke?.until ?? 0);
    const alone = this.others === 0 && speaker === me;
    if (followUp || alone) this.answer(last, text, speaker);
  }

  private answer(own: Own, said: string, asker: string) {
    const id = own.profile.id;
    const me = this.room.localParticipant.identity;
    const turnId = crypto.randomUUID();
    this.setState(id, "thinking");
    const call = agentCallTurn(own.profile, said, {
      asker: asker === me ? undefined : this.nameOf(asker),
      onSentence: (sentence) => this.speak(own, turnId, sentence),
    });
    own.turn = { id: turnId, call, asker, done: false, making: 0, chain: Promise.resolve() };
    call.finished
      .catch((reason: unknown) => {
        if (own.turn?.id !== turnId) return;
        notify({
          message:
            reason instanceof Error ? reason.message : `${own.profile.name} couldn’t finish that.`,
          tone: "error",
        });
      })
      .finally(() => {
        const turn = own.turn;
        if (turn?.id !== turnId) return;
        turn.done = true;
        void turn.chain.then(() => {
          if (own.turn?.id === turnId && own.state !== "speaking") this.caughtUp(id, turnId);
        });
      });
  }

  private speak(own: Own, turnId: string, sentence: string) {
    const turn = own.turn;
    if (!turn || turn.id !== turnId) return;
    turn.making += 1;
    const made = renderSpeech(sentence, voiceOf(own.profile));
    turn.chain = turn.chain
      .then(async () => {
        const speech = await made;
        if (own.turn?.id !== turnId) return;
        await own.voice.speak(speech.pcm, speech.rate);
        this.setState(own.profile.id, "speaking");
      })
      .catch(() => {
        if (own.turn?.id === turnId)
          notify({ message: `${own.profile.name} couldn’t speak that.`, tone: "error" });
      })
      .finally(() => {
        if (own.turn?.id === turnId) turn.making -= 1;
      });
  }

  private played(id: string) {
    const own = this.own.get(id);
    const turn = own?.turn;
    if (!own || !turn) return;
    if (turn.making > 0) return;
    this.caughtUp(id, turn.id);
  }

  private caughtUp(id: string, turnId: string) {
    const own = this.own.get(id);
    if (!own?.turn || own.turn.id !== turnId) return;
    if (!own.turn.done) return this.setState(id, "working");
    this.lastSpoke = { id, asker: own.turn.asker, until: Date.now() + FOLLOW_UP_MS };
    own.turn = undefined;
    this.setState(id, "listening");
  }

  private announce(id: string, to?: RemoteParticipant) {
    const own = this.own.get(id);
    if (own) void this.send({ t: "here", id, name: own.profile.name, state: own.state }, to);
  }

  private setState(id: string, state: CallAgentState) {
    const own = this.own.get(id);
    if (!own || own.state === state) return;
    own.state = state;
    this.announce(id);
    this.changed();
  }

  private async send(message: Message, to?: RemoteParticipant) {
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          await this.cipher,
          encoder.encode(JSON.stringify(message)),
        ),
      );
      const payload = new Uint8Array(iv.length + sealed.length);
      payload.set(iv, 0);
      payload.set(sealed, iv.length);
      await this.room.localParticipant.publishData(payload, {
        reliable: true,
        topic,
        ...(to ? { destinationIdentities: [to.identity] } : {}),
      });
    } catch {}
  }

  private received = (
    payload: Uint8Array,
    participant?: RemoteParticipant,
    _kind?: unknown,
    received?: string,
  ) => {
    if (received !== topic || !participant || this.disposed) return;
    void (async () => {
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: payload.slice(0, 12) },
        await this.cipher,
        payload.slice(12),
      );
      const message = readMessage(JSON.parse(decoder.decode(plain)));
      if (message && !this.disposed) this.apply(message, participant);
    })().catch(() => undefined);
  };

  private keyOf(id: string, participant?: Participant) {
    return `${participant?.identity ?? this.room.localParticipant.identity}:${id}`;
  }

  private apply(message: Message, participant: RemoteParticipant) {
    const key = this.keyOf(message.id, participant);
    if (message.t === "here")
      this.remote.set(key, {
        name: message.name,
        owner: participant.identity,
        state: message.state,
      });
    else this.remote.delete(key);
    this.changed();
  }

  private joined = (participant: RemoteParticipant) => {
    for (const id of this.own.keys()) this.announce(id, participant);
  };

  private departed = (participant: RemoteParticipant) => {
    this.stopHearing(participant.identity);
    let gone = false;
    for (const [key, remote] of this.remote) {
      if (remote.owner !== participant.identity) continue;
      this.remote.delete(key);
      gone = true;
    }
    if (gone) this.changed();
  };

  private changed() {
    const me = this.room.localParticipant.identity;
    this.snapshot = [
      ...[...this.own].map(([id, own]) => ({
        key: `${me}:${id}`,
        name: own.profile.name,
        owner: me,
        mine: true,
        state: own.state,
        profile: own.profile,
      })),
      ...[...this.remote].map(([key, remote]) => ({ key, ...remote, mine: false })),
    ];
    for (const listener of this.listeners) listener();
  }
}
