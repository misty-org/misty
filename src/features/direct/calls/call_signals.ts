import { RoomEvent, type RemoteParticipant, type Room } from "livekit-client";

const topic = "misty.signals";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const callReactions = [
  { emoji: "👍", label: "Thumbs up" },
  { emoji: "👎", label: "Thumbs down" },
  { emoji: "👏", label: "Clapping" },
  { emoji: "❤️", label: "Heart" },
  { emoji: "😂", label: "Laughing" },
  { emoji: "😮", label: "Surprised" },
  { emoji: "🎉", label: "Party" },
  { emoji: "🙏", label: "Thank you" },
];
const allowed = new Set(callReactions.map((reaction) => reaction.emoji));
const REACTION_MS = 2400;
const REACTION_GAP_MS = 250;
const CAPTION_MS = 7000;
const CAPTION_LINES = 3;
const CAPTION_LIMIT = 500;

type Signal =
  | { t: "hand"; up: boolean; at?: number }
  | { t: "deaf"; on: boolean }
  | { t: "react"; emoji: string }
  | { t: "cc"; on: boolean }
  | { t: "said"; text: string }
  | { t: "lower" }
  | { t: "muted" };

function readSignal(value: unknown): Signal | null {
  if (!value || typeof value !== "object") return null;
  const m = value as Record<string, unknown>;
  if (m.t === "hand" && typeof m.up === "boolean")
    return {
      t: "hand",
      up: m.up,
      ...(typeof m.at === "number" && Number.isFinite(m.at) ? { at: m.at } : {}),
    };
  if (m.t === "deaf" && typeof m.on === "boolean") return { t: "deaf", on: m.on };
  if (m.t === "react" && typeof m.emoji === "string" && allowed.has(m.emoji))
    return { t: "react", emoji: m.emoji };
  if (m.t === "cc" && typeof m.on === "boolean") return { t: "cc", on: m.on };
  if (m.t === "said" && typeof m.text === "string" && m.text.trim())
    return { t: "said", text: m.text.trim().slice(0, CAPTION_LIMIT) };
  if (m.t === "lower") return { t: "lower" };
  if (m.t === "muted") return { t: "muted" };
  return null;
}

export interface CallReaction {
  key: number;
  emoji: string;
}

export interface CallCaption {
  key: number;
  person: string;
  text: string;
}

export interface SignalsView {
  hands: ReadonlyMap<string, number>;
  deaf: ReadonlySet<string>;
  reactions: ReadonlyMap<string, CallReaction>;
  captionsWanted: ReadonlySet<string>;
  captions: readonly CallCaption[];
}

export interface SignalEvents {
  changed(): void;
  lowered(): void;
  muted(): void;
}

export class CallSignals {
  private cipher: Promise<CryptoKey>;
  private hands = new Map<string, number>();
  private deaf = new Set<string>();
  private reactions = new Map<string, CallReaction>();
  private lastReaction = new Map<string, number>();
  private wanted = new Set<string>();
  private captions: CallCaption[] = [];
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private captionTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private next = 0;
  private disposed = false;
  private view: SignalsView = {
    hands: this.hands,
    deaf: this.deaf,
    reactions: this.reactions,
    captionsWanted: this.wanted,
    captions: this.captions,
  };

  constructor(
    private readonly room: Room,
    key: Uint8Array<ArrayBuffer>,
    private readonly events: SignalEvents,
  ) {
    this.cipher = crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
    room.on(RoomEvent.DataReceived, this.received);
    room.on(RoomEvent.ParticipantConnected, this.joined);
    room.on(RoomEvent.ParticipantDisconnected, this.departed);
  }

  current = () => this.view;

  private get self() {
    return this.room.localParticipant.identity;
  }

  setHand(up: boolean) {
    const signal: Signal = up ? { t: "hand", up, at: Date.now() } : { t: "hand", up };
    this.apply(this.self, signal);
    void this.send(signal);
  }

  setDeaf(on: boolean) {
    this.apply(this.self, { t: "deaf", on });
    void this.send({ t: "deaf", on });
  }

  react(emoji: string) {
    if (!allowed.has(emoji)) return;
    this.apply(this.self, { t: "react", emoji });
    void this.send({ t: "react", emoji });
  }

  setCaptions(on: boolean) {
    this.apply(this.self, { t: "cc", on });
    void this.send({ t: "cc", on });
  }

  say(text: string) {
    const said = text.trim().slice(0, CAPTION_LIMIT);
    if (!said || !this.wanted.size) return;
    if (this.wanted.has(this.self)) this.apply(this.self, { t: "said", text: said });
    const to = [...this.wanted].filter((identity) => identity !== this.self);
    if (to.length) void this.send({ t: "said", text: said }, to);
  }

  lowerHandOf(identity: string) {
    void this.send({ t: "lower" }, [identity]);
  }

  tellMuted(identity: string) {
    void this.send({ t: "muted" }, [identity]);
  }

  dispose() {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const timer of this.captionTimers.values()) clearTimeout(timer);
    this.room.off(RoomEvent.DataReceived, this.received);
    this.room.off(RoomEvent.ParticipantConnected, this.joined);
    this.room.off(RoomEvent.ParticipantDisconnected, this.departed);
  }

  private publish() {
    this.view = {
      hands: new Map(this.hands),
      deaf: new Set(this.deaf),
      reactions: new Map(this.reactions),
      captionsWanted: new Set(this.wanted),
      captions: [...this.captions],
    };
    this.events.changed();
  }

  private apply(identity: string, signal: Signal) {
    if (this.disposed) return;
    switch (signal.t) {
      case "hand":
        if (!signal.up) this.hands.delete(identity);
        else if (!this.hands.has(identity) || signal.at !== undefined)
          this.hands.set(identity, signal.at ?? Date.now());
        break;
      case "deaf":
        if (signal.on) this.deaf.add(identity);
        else this.deaf.delete(identity);
        break;
      case "cc":
        if (signal.on) this.wanted.add(identity);
        else this.wanted.delete(identity);
        break;
      case "said":
        this.caption(identity, signal.text);
        return;
      case "lower":
        if (identity !== this.self && this.hands.has(this.self)) {
          this.setHand(false);
          this.events.lowered();
        }
        return;
      case "muted":
        if (identity !== this.self) this.events.muted();
        return;
      case "react": {
        const now = Date.now();
        if (now - (this.lastReaction.get(identity) ?? 0) < REACTION_GAP_MS) return;
        this.lastReaction.set(identity, now);
        this.reactions.set(identity, { key: this.next++, emoji: signal.emoji });
        clearTimeout(this.timers.get(identity));
        this.timers.set(
          identity,
          setTimeout(() => {
            this.timers.delete(identity);
            this.reactions.delete(identity);
            this.publish();
          }, REACTION_MS),
        );
        break;
      }
    }
    this.publish();
  }

  private caption(person: string, text: string) {
    if (!this.wanted.has(this.self)) return;
    const key = this.next++;
    this.captions = [...this.captions, { key, person, text }].slice(-CAPTION_LINES);
    this.captionTimers.set(
      key,
      setTimeout(() => {
        this.captionTimers.delete(key);
        this.captions = this.captions.filter((line) => line.key !== key);
        this.publish();
      }, CAPTION_MS),
    );
    this.publish();
  }

  private async send(signal: Signal, to?: string[]) {
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          await this.cipher,
          encoder.encode(JSON.stringify(signal)),
        ),
      );
      const payload = new Uint8Array(iv.length + sealed.length);
      payload.set(iv, 0);
      payload.set(sealed, iv.length);
      await this.room.localParticipant.publishData(payload, {
        reliable: true,
        topic,
        ...(to ? { destinationIdentities: to } : {}),
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
      const signal = readSignal(JSON.parse(decoder.decode(plain)));
      if (signal) this.apply(participant.identity, signal);
    })().catch(() => undefined);
  };

  private joined = (participant: RemoteParticipant) => {
    const to = [participant.identity];
    const raised = this.hands.get(this.self);
    if (raised !== undefined) void this.send({ t: "hand", up: true, at: raised }, to);
    if (this.deaf.has(this.self)) void this.send({ t: "deaf", on: true }, to);
    if (this.wanted.has(this.self)) void this.send({ t: "cc", on: true }, to);
  };

  private departed = (participant: RemoteParticipant) => {
    const identity = participant.identity;
    this.hands.delete(identity);
    this.deaf.delete(identity);
    this.wanted.delete(identity);
    this.reactions.delete(identity);
    this.lastReaction.delete(identity);
    clearTimeout(this.timers.get(identity));
    this.timers.delete(identity);
    this.publish();
  };
}
