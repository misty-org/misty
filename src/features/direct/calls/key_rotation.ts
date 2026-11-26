import {
  BaseKeyProvider,
  ConnectionState,
  RoomEvent,
  createKeyMaterialFromBuffer,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type Room,
} from "livekit-client";
import { deviceCallKey, newCallKey, openCallKeyWith, sealCallKey } from "./call_keys";

export const keyTopic = "misty.call-key";
const keyIdAttribute = "misty.key-id";
const publicKeyAttribute = "misty.key";
const keyedAttribute = "misty.keyed";
const groupAttribute = "misty.key-group";
const epochAttribute = "misty.key-epoch";
const ringSize = 16;
const turns = ringSize - 1;
const MOST_EPOCH = 2 ** 31;
const FAILURE_TOLERANCE = 10;
const ACK_WAIT_MS = 2_000;
const WELCOME_WAIT_MS = 5_000;
const DEPARTURE_SETTLE_MS = 1_000;
const JOIN_SETTLE_MS = 1_000;
const ASK_GAP_MS = 3_000;

type Sealed = Record<string, string>;
type KeyInfo = ReturnType<BaseKeyProvider["getKeys"]>[number];

export interface SealedSlot {
  index: number;
  epoch: number;
  keys: Sealed;
}

export type KeyMessage =
  | {
      kind: "key";
      index: number;
      epoch?: number;
      keys: Sealed;
      switch: boolean;
      base?: Sealed;
      group?: string;
      to?: string;
      also?: SealedSlot[];
    }
  | { kind: "use"; index: number; epoch?: number }
  | { kind: "ack"; index: number; epoch?: number }
  | { kind: "ask"; keyId: string; publicKey: string; keyed?: boolean };

export class CallKeyProvider extends BaseKeyProvider {
  private ring = new Map<number, CryptoKey>();
  private sending = 0;
  private self?: string;
  private people = new Set<string>();

  constructor() {
    super({
      sharedKey: false,
      ratchetWindowSize: 0,
      failureTolerance: FAILURE_TOLERANCE,
      keyringSize: ringSize,
    });
  }

  get index() {
    return this.sending;
  }

  has(index: number) {
    return this.ring.has(index);
  }

  async remember(key: Uint8Array<ArrayBuffer>, index: number) {
    const material = await createKeyMaterialFromBuffer(key.buffer);
    this.ring.set(index, material);
    for (const identity of this.people) this.onSetEncryptionKey(material, identity, index);
  }

  refresh(identity: string, index: number) {
    const material = this.ring.get(index);
    if (!material || !this.people.has(identity)) return false;
    this.onSetEncryptionKey(material, identity, index);
    return true;
  }

  use(index: number) {
    const material = this.ring.get(index);
    if (!material) return false;
    this.sending = index;
    if (this.self) this.onSetEncryptionKey(material, this.self, index);
    return true;
  }

  bindSelf(identity: string) {
    this.self = identity;
    this.people.delete(identity);
    this.use(this.sending);
  }

  addPerson(identity: string) {
    if (!identity || identity === this.self) return;
    this.people.add(identity);
    for (const [index, material] of this.ring) this.onSetEncryptionKey(material, identity, index);
  }

  removePerson(identity: string) {
    this.people.delete(identity);
  }

  override getKeys(): KeyInfo[] {
    const keys: KeyInfo[] = [];
    for (const identity of this.people)
      for (const [index, key] of this.ring)
        keys.push({ key, participantIdentity: identity, keyIndex: index });
    const sending = this.ring.get(this.sending);
    if (this.self && sending)
      keys.push({ key: sending, participantIdentity: this.self, keyIndex: this.sending });
    return keys;
  }
}

export const slotOf = (epoch: number) => (epoch <= 0 ? 0 : ((epoch - 1) % turns) + 1);

export const nextIndex = (index: number) => (index % turns) + 1;

export function nearestEpoch(index: number, around: number) {
  if (index <= 0) return 0;
  const turn = Math.max(0, Math.round((around - index) / turns));
  return index + turn * turns;
}

export const ranksBefore = (a: string, b: string) => a < b;

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function keeperOf<T extends { identity: string; sid: string }>(people: T[]): T | undefined {
  return [...people].sort((a, b) => order(a.identity, b.identity) || order(a.sid, b.sid))[0];
}

export async function keyGroup(key: Uint8Array<ArrayBuffer>) {
  const label = new TextEncoder().encode("misty.call-group:");
  const bytes = new Uint8Array(label.length + key.length);
  bytes.set(label, 0);
  bytes.set(key, label.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let binary = "";
  for (const byte of digest.slice(0, 12)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const isIndex = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value < ringSize;

const isEpoch = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MOST_EPOCH;

const isSealed = (value: unknown): value is Sealed =>
  Boolean(value) &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value as object).every((sealed) => typeof sealed === "string");

const isText = (value: unknown, most: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= most;

const fits = (epoch: unknown, index: number) =>
  epoch === undefined || (isEpoch(epoch) && slotOf(epoch) === index);

function parseSlots(value: unknown): SealedSlot[] | undefined {
  if (!Array.isArray(value) || value.length > ringSize) return undefined;
  const slots: SealedSlot[] = [];
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== "object") return undefined;
    const slot = entry as Record<string, unknown>;
    if (!isIndex(slot.index) || !isEpoch(slot.epoch) || slotOf(slot.epoch) !== slot.index)
      return undefined;
    if (!isSealed(slot.keys)) return undefined;
    slots.push({ index: slot.index, epoch: slot.epoch, keys: slot.keys });
  }
  return slots.length ? slots : undefined;
}

export function parseKeyMessage(payload: Uint8Array): KeyMessage | undefined {
  try {
    const value = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown> | null;
    if (!value || typeof value !== "object") return undefined;
    if (isIndex(value.index) && isSealed(value.keys)) {
      if (!fits(value.epoch, value.index)) return undefined;
      const also = parseSlots(value.also);
      return {
        kind: "key",
        index: value.index,
        ...(isEpoch(value.epoch) ? { epoch: value.epoch } : {}),
        keys: value.keys,
        switch: value.switch !== false,
        ...(isSealed(value.base) ? { base: value.base } : {}),
        ...(isText(value.group, 64) ? { group: value.group } : {}),
        ...(isText(value.to, 256) ? { to: value.to } : {}),
        ...(also ? { also } : {}),
      };
    }
    if (isIndex(value.use))
      return fits(value.epoch, value.use)
        ? {
            kind: "use",
            index: value.use,
            ...(isEpoch(value.epoch) ? { epoch: value.epoch } : {}),
          }
        : undefined;
    if (isIndex(value.ack))
      return fits(value.epoch, value.ack)
        ? {
            kind: "ack",
            index: value.ack,
            ...(isEpoch(value.epoch) ? { epoch: value.epoch } : {}),
          }
        : undefined;
    if (value.ask === true && isText(value.keyId, 128) && isText(value.publicKey, 256))
      return {
        kind: "ask",
        keyId: value.keyId,
        publicKey: value.publicKey,
        ...(typeof value.keyed === "boolean" ? { keyed: value.keyed } : {}),
      };
    return undefined;
  } catch {
    return undefined;
  }
}

export function wireKeyMessage(message: KeyMessage) {
  switch (message.kind) {
    case "key":
      return {
        index: message.index,
        ...(message.epoch !== undefined ? { epoch: message.epoch } : {}),
        keys: message.keys,
        switch: message.switch,
        ...(message.base ? { base: message.base } : {}),
        ...(message.group ? { group: message.group } : {}),
        ...(message.to ? { to: message.to } : {}),
        ...(message.also?.length ? { also: message.also } : {}),
      };
    case "use":
      return {
        use: message.index,
        ...(message.epoch !== undefined ? { epoch: message.epoch } : {}),
      };
    case "ack":
      return {
        ack: message.index,
        ...(message.epoch !== undefined ? { epoch: message.epoch } : {}),
      };
    case "ask":
      return {
        ask: true,
        keyId: message.keyId,
        publicKey: message.publicKey,
        ...(message.keyed !== undefined ? { keyed: message.keyed } : {}),
      };
  }
}

export async function sealKeyFor(
  key: Uint8Array<ArrayBuffer>,
  computers: { keyId: string; publicKey: string }[],
): Promise<Record<string, string>> {
  const keys: Record<string, string> = {};
  for (const computer of computers)
    keys[computer.keyId] = await sealCallKey(key, computer.publicKey);
  return keys;
}

function computerOf(participant: Participant) {
  const keyId = participant.attributes[keyIdAttribute];
  const publicKey = participant.attributes[publicKeyAttribute];
  return keyId && publicKey ? { keyId, publicKey } : undefined;
}

function announcedEpoch(participant: Participant) {
  const text = participant.attributes[epochAttribute];
  if (!text || !/^\d{1,10}$/.test(text)) return undefined;
  const epoch = Number(text);
  return isEpoch(epoch) ? epoch : undefined;
}

export interface KeyEvents {
  keyed(): void;
  base(key: Uint8Array<ArrayBuffer>): void;
}

export interface KeyRotation {
  readonly ready: Promise<void>;
  readonly keyed: boolean;
  readonly epoch: number;
  readonly latest: number;
  readonly group: string;
  ask(): void;
  check(identity: string): void;
  refresh(identity?: string): void;
  stop(): void;
}

interface Held {
  key: Uint8Array<ArrayBuffer>;
  epoch: number;
  from: string;
}

type Trust = "none" | "timeout" | "trusted";

export async function startKeyRotation(
  room: Room,
  provider: CallKeyProvider,
  firstKey: Uint8Array<ArrayBuffer>,
  events: KeyEvents,
): Promise<KeyRotation> {
  const own = await deviceCallKey();
  const self = room.localParticipant;
  provider.bindSelf(self.identity);
  for (const person of room.remoteParticipants.values()) provider.addPerson(person.identity);

  let base = firstKey;
  let group = await keyGroup(firstKey);
  const held = new Map<number, Held>([[0, { key: firstKey, epoch: 0, from: self.identity }]]);
  let current = 0;
  let latest = 0;
  let pending: number | undefined;
  let rotation:
    { epoch: number; waiting: Set<string>; abandoned: boolean; done(): void } | undefined;
  let rotating: Promise<void> | undefined;
  let again = false;
  let trust: Trust = room.remoteParticipants.size === 0 ? "trusted" : "none";
  let stopped = false;
  let lastAsk = 0;
  let restarted = false;
  let announced = "";
  let chain: Promise<unknown> = Promise.resolve();
  const departed = new Set<string>();
  let departTimer: ReturnType<typeof setTimeout> | undefined;
  let welcomeTimer: ReturnType<typeof setTimeout> | undefined;
  const arrived = new Map<string, number>();
  const settling = new Map<string, ReturnType<typeof setTimeout>>();
  let askTimer: ReturnType<typeof setTimeout> | undefined;
  let markReady = () => undefined as void;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  const keyed = () => trust !== "none";
  const trusted = () => trust === "trusted";
  const quietly = (work: Promise<unknown>) => void work.catch(() => undefined);
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = chain.then(() => (stopped ? (undefined as T) : work()));
    chain = run.catch(() => undefined);
    return run;
  };

  const attributes = (): Record<string, string> => ({
    [keyIdAttribute]: own.keyId,
    [publicKeyAttribute]: own.publicKey,
    [keyedAttribute]: trusted() ? "1" : "",
    [groupAttribute]: keyed() ? group : "",
    [epochAttribute]: keyed() ? String(current) : "",
  });
  const announce = (force = false) => {
    if (stopped) return;
    const next = attributes();
    const text = JSON.stringify(next);
    if (!force && text === announced) return;
    announced = text;
    quietly(self.setAttributes(next));
  };

  const isKeyed = (person: Participant) =>
    person === self ? trusted() : person.attributes[keyedAttribute] === "1";
  const sealable = () =>
    [...room.remoteParticipants.values()].filter((person) => computerOf(person));
  const keeperNow = (except?: string): Participant | undefined =>
    keeperOf<Participant>([
      ...(trusted() ? [self] : []),
      ...sealable().filter((person) => person.identity !== except && isKeyed(person)),
    ]);
  const keeping = (except?: string) => trusted() && keeperNow(except)?.identity === self.identity;
  const outranks = (identity: string) => trusted() && ranksBefore(self.identity, identity);

  const send = async (message: KeyMessage, to?: string[]) => {
    if (stopped) return;
    const payload = new TextEncoder().encode(JSON.stringify(wireKeyMessage(message)));
    await self.publishData(payload, {
      reliable: true,
      topic: keyTopic,
      ...(to ? { destinationIdentities: to } : {}),
    });
  };

  const holding = (epoch: number) => {
    const entry = held.get(slotOf(epoch));
    return entry?.epoch === epoch ? entry : undefined;
  };
  const keep = async (key: Uint8Array<ArrayBuffer>, epoch: number, from: string) => {
    held.set(slotOf(epoch), { key, epoch, from });
    await provider.remember(key, slotOf(epoch));
  };
  const keepNewer = async (key: Uint8Array<ArrayBuffer>, epoch: number, from: string) => {
    const there = held.get(slotOf(epoch));
    if (there && there.epoch >= epoch) return false;
    await keep(key, epoch, from);
    return true;
  };
  const raise = (epoch: number) => {
    if (epoch > latest) latest = epoch;
  };
  const switchTo = (epoch: number) => {
    if (!holding(epoch)) return false;
    provider.use(slotOf(epoch));
    current = epoch;
    raise(epoch);
    if (pending !== undefined && pending <= epoch) pending = undefined;
    announce();
    return true;
  };

  const settleTrust = (next: Trust) => {
    clearTimeout(welcomeTimer);
    welcomeTimer = undefined;
    if (stopped) {
      markReady();
      return;
    }
    const wasKeyed = keyed();
    if (next === "trusted" || (next === "timeout" && trust === "none")) trust = next;
    announce();
    if (!wasKeyed && keyed()) events.keyed();
    markReady();
  };

  const claim = () => {
    if (stopped || trusted() || keeperNow()) return false;
    settleTrust("trusted");
    return true;
  };

  const ask = () => {
    if (stopped || !room.remoteParticipants.size) return;
    const wait = lastAsk + ASK_GAP_MS - Date.now();
    if (wait > 0) {
      askTimer ??= setTimeout(() => {
        askTimer = undefined;
        ask();
      }, wait);
      return;
    }
    lastAsk = Date.now();
    quietly(send({ kind: "ask", keyId: own.keyId, publicKey: own.publicKey, keyed: trusted() }));
  };

  const reconcile = (person?: Participant) => {
    if (stopped || !keyed()) return;
    if (trust === "timeout") claim();
    const keeper = keeperNow();
    const keeperGroup = keeper && keeper !== self ? keeper.attributes[groupAttribute] : undefined;
    if (keeperGroup && keeperGroup !== group) {
      ask();
      return;
    }
    if (keeping()) {
      if (person) {
        const epoch = announcedEpoch(person);
        if (epoch !== undefined && holding(epoch)) provider.refresh(person.identity, slotOf(epoch));
      }
      return;
    }
    let missing = false;
    for (const other of person ? [person] : room.remoteParticipants.values()) {
      if (other === self || other.attributes[groupAttribute] !== group) continue;
      const epoch = announcedEpoch(other);
      if (epoch === undefined) continue;
      if (holding(epoch)) {
        if (person) provider.refresh(other.identity, slotOf(epoch));
      } else if (epoch > (held.get(slotOf(epoch))?.epoch ?? -1)) missing = true;
    }
    if (missing) ask();
  };

  const later = (person?: Participant) =>
    quietly(
      serial(async () => {
        reconcile(person);
      }),
    );

  const welcome = async (to: string, computer: { keyId: string; publicKey: string }) => {
    if (stopped || !keeping(to)) return;
    const sending = holding(current);
    if (!sending) return;
    const seal = (key: Uint8Array<ArrayBuffer>) => sealKeyFor(key, [computer]);
    const wanted = new Set<number>();
    for (const person of room.remoteParticipants.values()) {
      if (person.identity === to || person.attributes[groupAttribute] !== group) continue;
      const epoch = announcedEpoch(person);
      if (epoch !== undefined) wanted.add(epoch);
    }
    if (pending !== undefined) wanted.add(pending);
    wanted.delete(current);
    wanted.delete(0);
    const also: SealedSlot[] = [];
    for (const epoch of [...wanted].sort((a, b) => a - b)) {
      const entry = holding(epoch);
      if (entry) also.push({ index: slotOf(epoch), epoch, keys: await seal(entry.key) });
    }
    await send(
      {
        kind: "key",
        index: slotOf(current),
        epoch: current,
        keys: await seal(sending.key),
        switch: true,
        base: current === 0 ? undefined : await seal(base),
        group,
        to,
        also,
      },
      [to],
    );
  };

  const settleWait = (person: Participant) =>
    (arrived.get(person.identity) ?? 0) + JOIN_SETTLE_MS - Date.now();
  const welcomeOnceSettled = (
    person: RemoteParticipant,
    computer: { keyId: string; publicKey: string },
    wait: number,
  ) => {
    clearTimeout(settling.get(person.identity));
    settling.set(
      person.identity,
      setTimeout(() => {
        settling.delete(person.identity);
        if (stopped || room.remoteParticipants.get(person.identity)?.sid !== person.sid) return;
        quietly(serial(() => welcome(person.identity, computer)));
      }, wait),
    );
  };
  const welcomeSoon = (
    person: RemoteParticipant,
    computer: { keyId: string; publicKey: string },
  ) => {
    const wait = settleWait(person);
    if (wait > 0) welcomeOnceSettled(person, computer, wait);
    else quietly(serial(() => welcome(person.identity, computer)));
  };

  const rotateOnce = async () => {
    const started = await serial(async () => {
      if (stopped || !keeping()) return undefined;
      const key = newCallKey();
      const epoch = latest + 1;
      const people = sealable().filter((person) => settleWait(person) <= 0);
      raise(epoch);
      await keep(key, epoch, self.identity);
      pending = epoch;
      const waiting = new Set(people.filter(isKeyed).map((person) => person.identity));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settled = new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        rotation = { epoch, waiting, abandoned: false, done };
        timer = setTimeout(done, ACK_WAIT_MS);
        if (!waiting.size) done();
      });
      if (people.length)
        await send({
          kind: "key",
          index: slotOf(epoch),
          epoch,
          keys: await sealKeyFor(
            key,
            people.map((person) => computerOf(person)!),
          ),
          switch: false,
          group,
        });
      return { epoch, settled };
    });
    if (!started) return;
    await started.settled;
    await serial(async () => {
      const finished = rotation;
      rotation = undefined;
      if (stopped || !finished || finished.abandoned || finished.epoch !== started.epoch) return;
      await send({ kind: "use", index: slotOf(started.epoch), epoch: started.epoch });
      switchTo(started.epoch);
    });
  };

  const rotate = () => {
    if (stopped) return;
    if (rotating) {
      again = true;
      return;
    }
    rotating = (async () => {
      do {
        again = false;
        await rotateOnce().catch(() => undefined);
      } while (again && !stopped);
    })().finally(() => {
      rotating = undefined;
    });
  };

  const settleDepartures = () => {
    clearTimeout(departTimer);
    departTimer = setTimeout(() => {
      departTimer = undefined;
      if (stopped || room.state !== ConnectionState.Connected) return;
      for (const identity of [...departed])
        if (room.remoteParticipants.has(identity)) departed.delete(identity);
      if (!departed.size) return;
      departed.clear();
      rotate();
    }, DEPARTURE_SETTLE_MS);
  };

  const open = (sealed: string) => openCallKeyWith(own.privateKey, sealed);

  const takeWelcome = async (
    message: Extract<KeyMessage, { kind: "key" }>,
    epoch: number,
    from: RemoteParticipant,
    sealed: string,
  ) => {
    if (outranks(from.identity)) return;
    const key = await open(sealed);
    const sealedBase = message.base?.[own.keyId];
    const nextBase = sealedBase ? await open(sealedBase) : epoch === 0 ? key : undefined;
    const nextGroup = nextBase ? await keyGroup(nextBase) : group;
    if (stopped) return;
    const others: { key: Uint8Array<ArrayBuffer>; epoch: number }[] = [];
    for (const slot of message.also ?? []) {
      const sealedSlot = slot.keys[own.keyId];
      if (sealedSlot) others.push({ key: await open(sealedSlot), epoch: slot.epoch });
    }
    if (stopped) return;
    const moving = nextGroup !== group;
    if (moving && nextBase) {
      held.clear();
      base = nextBase;
      group = nextGroup;
      current = 0;
      latest = 0;
      pending = undefined;
      await keep(nextBase, 0, from.identity);
      events.base(nextBase);
    } else if (nextBase && epoch !== 0 && !holding(0)) {
      await keep(nextBase, 0, from.identity);
    }
    await keepNewer(key, epoch, from.identity);
    for (const other of others) {
      await keepNewer(other.key, other.epoch, from.identity);
      raise(other.epoch);
      if (other.epoch > epoch && other.epoch > current && holding(other.epoch))
        pending = Math.max(pending ?? 0, other.epoch);
    }
    if (stopped) return;
    if (epoch >= current || moving) switchTo(epoch);
    else raise(epoch);
    settleTrust("trusted");
    quietly(send({ kind: "ack", index: slotOf(epoch), epoch }));
    announce();
  };

  const takeRotation = async (
    message: Extract<KeyMessage, { kind: "key" }>,
    epoch: number,
    from: RemoteParticipant,
    sealed: string,
  ) => {
    if (message.group && message.group !== group) return;
    if (epoch === 0 || epoch < current) return;
    const there = held.get(slotOf(epoch));
    if (there && there.epoch > epoch) return;
    if (
      there &&
      there.epoch === epoch &&
      there.from !== from.identity &&
      !ranksBefore(from.identity, there.from)
    )
      return;
    const key = await open(sealed);
    if (stopped) return;
    if (rotation && rotation.epoch === epoch && ranksBefore(from.identity, self.identity)) {
      rotation.abandoned = true;
      rotation.done();
    }
    await keep(key, epoch, from.identity);
    raise(epoch);
    pending = epoch;
    quietly(send({ kind: "ack", index: slotOf(epoch), epoch }, [from.identity]));
  };

  const receive = async (message: KeyMessage, from: RemoteParticipant) => {
    switch (message.kind) {
      case "key": {
        const sealed = message.keys[own.keyId];
        if (!sealed) return;
        const addressed = message.to
          ? message.to === self.identity
          : !message.switch || keeperNow()?.identity === from.identity;
        if (!addressed) return;
        const epoch =
          message.epoch ??
          nearestEpoch(message.index, message.switch ? Math.max(current, latest) : latest + 1);
        if (message.switch) await takeWelcome(message, epoch, from, sealed);
        else await takeRotation(message, epoch, from, sealed);
        return;
      }
      case "use": {
        const epoch = message.epoch ?? nearestEpoch(message.index, latest);
        const entry = holding(epoch);
        const fromKeeper =
          keeperNow()?.identity === from.identity && from.attributes[groupAttribute] === group;
        if (!entry) {
          if (epoch > current && from.attributes[groupAttribute] === group) ask();
          return;
        }
        if (entry.from !== from.identity && !fromKeeper) return;
        raise(epoch);
        if (epoch > current) switchTo(epoch);
        if (!trusted() && fromKeeper) settleTrust("trusted");
        return;
      }
      case "ack": {
        provider.addPerson(from.identity);
        if (!rotation) return;
        const epoch = message.epoch ?? nearestEpoch(message.index, rotation.epoch);
        if (rotation.epoch === epoch) {
          rotation.waiting.delete(from.identity);
          if (!rotation.waiting.size) rotation.done();
        }
        return;
      }
      case "ask": {
        provider.addPerson(from.identity);
        if (message.keyed && ranksBefore(from.identity, self.identity)) return;
        const computer = { keyId: message.keyId, publicKey: message.publicKey };
        const wait = settleWait(from);
        if (wait > 0) welcomeOnceSettled(from, computer, wait);
        else await welcome(from.identity, computer);
        return;
      }
    }
  };

  const onLeft = (person: RemoteParticipant) => {
    provider.removePerson(person.identity);
    arrived.delete(person.identity);
    clearTimeout(settling.get(person.identity));
    settling.delete(person.identity);
    if (rotation?.waiting.delete(person.identity) && !rotation.waiting.size) rotation.done();
    departed.add(person.identity);
    queueMicrotask(() => {
      if (room.state !== ConnectionState.Connected) {
        restarted = true;
        return;
      }
      if (!room.remoteParticipants.size && !trusted()) settleTrust("trusted");
      else if (trust === "timeout") later();
    });
    settleDepartures();
  };
  const onJoined = (person: RemoteParticipant) => {
    departed.delete(person.identity);
    arrived.set(person.identity, Date.now());
    provider.addPerson(person.identity);
    const computer = computerOf(person);
    if (computer && !isKeyed(person)) welcomeSoon(person, computer);
    later(person);
  };
  const onAttributes = (_changed: Record<string, string>, person: Participant) => {
    if (person === self || person.identity === self.identity) return;
    const computer = computerOf(person);
    const remote = room.remoteParticipants.get(person.identity);
    if (computer && remote && !isKeyed(person)) welcomeSoon(remote, computer);
    later(person);
  };
  const onSubscribed = (
    _track: RemoteTrack,
    _publication: RemoteTrackPublication,
    person: RemoteParticipant,
  ) => {
    provider.addPerson(person.identity);
    later(person);
  };
  const onData = (
    payload: Uint8Array,
    from?: RemoteParticipant,
    _kind?: unknown,
    topic?: string,
  ) => {
    if (topic !== keyTopic || !from || stopped) return;
    const message = parseKeyMessage(payload);
    if (message) quietly(serial(() => receive(message, from)));
  };
  const onReconnected = () => {
    if (stopped) return;
    for (const person of room.remoteParticipants.values()) provider.addPerson(person.identity);
    if (restarted) {
      restarted = false;
      if (room.remoteParticipants.size) trust = "none";
    }
    announce(true);
    if (!keyed()) {
      lastAsk = 0;
      ask();
      waitForWelcome();
    } else later();
    if (departed.size) settleDepartures();
  };
  const waitForWelcome = () => {
    clearTimeout(welcomeTimer);
    welcomeTimer = setTimeout(() => {
      welcomeTimer = undefined;
      if (!claim()) settleTrust("timeout");
    }, WELCOME_WAIT_MS);
  };

  room
    .on(RoomEvent.ParticipantDisconnected, onLeft)
    .on(RoomEvent.ParticipantConnected, onJoined)
    .on(RoomEvent.ParticipantAttributesChanged, onAttributes)
    .on(RoomEvent.TrackSubscribed, onSubscribed)
    .on(RoomEvent.DataReceived, onData)
    .on(RoomEvent.Reconnected, onReconnected);

  const stop = () => {
    stopped = true;
    clearTimeout(departTimer);
    clearTimeout(welcomeTimer);
    clearTimeout(askTimer);
    for (const timer of settling.values()) clearTimeout(timer);
    settling.clear();
    rotation?.done();
    markReady();
    room
      .off(RoomEvent.ParticipantDisconnected, onLeft)
      .off(RoomEvent.ParticipantConnected, onJoined)
      .off(RoomEvent.ParticipantAttributesChanged, onAttributes)
      .off(RoomEvent.TrackSubscribed, onSubscribed)
      .off(RoomEvent.DataReceived, onData)
      .off(RoomEvent.Reconnected, onReconnected);
  };

  announce(true);
  if (keyed()) {
    markReady();
    later();
  } else {
    ask();
    waitForWelcome();
  }

  return {
    ready,
    get keyed() {
      return keyed();
    },
    get epoch() {
      return current;
    },
    get latest() {
      return latest;
    },
    get group() {
      return group;
    },
    ask,
    check(identity: string) {
      const person = room.remoteParticipants.get(identity);
      if (person) later(person);
    },
    refresh(identity?: string) {
      if (stopped) return;
      if (identity === self.identity) {
        provider.use(provider.index);
        return;
      }
      const person = identity ? room.remoteParticipants.get(identity) : undefined;
      for (const other of person ? [person] : room.remoteParticipants.values())
        provider.addPerson(other.identity);
    },
    stop,
  };
}
