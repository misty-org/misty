import {
  BaseKeyProvider,
  RoomEvent,
  createKeyMaterialFromBuffer,
  type Participant,
  type RemoteParticipant,
  type Room,
} from "livekit-client";
import { deviceCallKey, newCallKey, openCallKeyWith, sealCallKey } from "./callKeys";

/**
 * A new call key whenever someone leaves, so they can't decrypt what follows.
 *
 * LiveKit keeps a ring of keys and marks each frame with the index of the key that encrypted it, so a
 * new key goes in the next slot while the old one stays readable: frames sent before a computer
 * switches still play. Each computer names its own sealing key in its participant attributes. When
 * someone leaves, one person who stays (the first by identity, so only one does it) makes a new key,
 * seals it for each other computer in the room and sends it over the room's data channel. Someone who
 * joins after a change gets the key in use from that same person, sealed for their computer only.
 * The leaver's computer is no longer in the room, so nothing is sealed for it.
 */

/** The data channel topic call keys travel on. */
export const keyTopic = "misty.call-key";
/** The participant attributes naming a computer's sealing key. */
const keyIdAttribute = "misty.key-id";
const publicKeyAttribute = "misty.key";
/** LiveKit's key ring holds this many keys; indices wrap around it. */
const ringSize = 16;

/** One key change: the key's slot, and the key sealed for each computer by its key id. */
export interface KeyMessage {
  index: number;
  keys: Record<string, string>;
}

/** The key provider for calls: one shared key per slot, set by index. */
export class CallKeyProvider extends BaseKeyProvider {
  constructor() {
    // As LiveKit's own shared-key provider: a frame that won't decrypt never ends the call or
    // ratchets the key, since it is only a frame sent under a key this computer hasn't got yet.
    super({ sharedKey: true, ratchetWindowSize: 0, failureTolerance: -1, keyringSize: ringSize });
  }

  async setKeyAt(key: Uint8Array<ArrayBuffer>, index: number) {
    this.onSetEncryptionKey(await createKeyMaterialFromBuffer(key.buffer), undefined, index);
  }
}

/** The next slot after `index`, wrapping around the ring. */
export const nextIndex = (index: number) => (index + 1) % ringSize;

/** Who hands out keys: the first of those who can be sealed for, by identity then session id. */
export function keeperOf(people: { identity: string; sid: string }[]) {
  return [...people].sort((a, b) =>
    a.identity === b.identity ? a.sid.localeCompare(b.sid) : a.identity.localeCompare(b.identity),
  )[0];
}

/** A key message as it came off the data channel, or undefined when it isn't one. */
export function parseKeyMessage(payload: Uint8Array): KeyMessage | undefined {
  try {
    const value = JSON.parse(new TextDecoder().decode(payload)) as Partial<KeyMessage>;
    if (
      typeof value.index !== "number" ||
      !Number.isInteger(value.index) ||
      value.index < 0 ||
      value.index >= ringSize ||
      !value.keys ||
      typeof value.keys !== "object"
    )
      return undefined;
    return { index: value.index, keys: value.keys };
  } catch {
    return undefined;
  }
}

/** Seals `key` for every computer listed, by key id. */
export async function sealKeyFor(
  key: Uint8Array<ArrayBuffer>,
  computers: { keyId: string; publicKey: string }[],
): Promise<Record<string, string>> {
  const keys: Record<string, string> = {};
  for (const computer of computers) keys[computer.keyId] = await sealCallKey(key, computer.publicKey);
  return keys;
}

function computerOf(participant: Participant) {
  const keyId = participant.attributes[keyIdAttribute];
  const publicKey = participant.attributes[publicKeyAttribute];
  return keyId && publicKey ? { keyId, publicKey } : undefined;
}

/**
 * Starts key changes for a connected room whose first key (slot 0) is already set. Returns what
 * stops them.
 */
export async function startKeyRotation(
  room: Room,
  provider: CallKeyProvider,
  firstKey: Uint8Array<ArrayBuffer>,
): Promise<() => void> {
  const own = await deviceCallKey();
  let current = { key: firstKey, index: 0 };
  let stopped = false;
  await room.localParticipant.setAttributes({
    [keyIdAttribute]: own.keyId,
    [publicKeyAttribute]: own.publicKey,
  });

  const sealable = () => [...room.remoteParticipants.values()].filter((person) => computerOf(person));
  const keeping = () => {
    const keeper = keeperOf([room.localParticipant, ...sealable()]);
    return keeper?.identity === room.localParticipant.identity;
  };
  const send = async (message: KeyMessage, to?: RemoteParticipant) => {
    const payload = new TextEncoder().encode(JSON.stringify(message));
    await room.localParticipant.publishData(payload, {
      reliable: true,
      topic: keyTopic,
      destinationIdentities: to ? [to.identity] : undefined,
    });
  };

  const rotate = async () => {
    if (stopped || !keeping()) return;
    const next = { key: newCallKey(), index: nextIndex(current.index) };
    const computers = sealable().map((person) => computerOf(person)!);
    if (computers.length) await send({ index: next.index, keys: await sealKeyFor(next.key, computers) });
    if (stopped) return;
    await provider.setKeyAt(next.key, next.index);
    current = next;
  };
  // Someone who joins after a change hasn't got the key in use: the keeper sends it to them.
  const welcome = async (person: RemoteParticipant) => {
    const computer = computerOf(person);
    if (stopped || !computer || current.index === 0 || !keeping()) return;
    await send({ index: current.index, keys: await sealKeyFor(current.key, [computer]) }, person);
  };
  const receive = async (payload: Uint8Array, from?: RemoteParticipant, _kind?: unknown, topic?: string) => {
    if (topic !== keyTopic || !from) return;
    const message = parseKeyMessage(payload);
    const sealed = message?.keys[own.keyId];
    if (!message || !sealed) return;
    const key = await openCallKeyWith(own.privateKey, sealed);
    if (stopped) return;
    await provider.setKeyAt(key, message.index);
    current = { key, index: message.index };
  };

  const quietly = (work: Promise<unknown>) => void work.catch(() => undefined);
  const onLeft = () => quietly(rotate());
  const onJoined = (person: RemoteParticipant) => quietly(welcome(person));
  const onAttributes = (_changed: Record<string, string>, person: Participant) => {
    if (person !== room.localParticipant) quietly(welcome(person as RemoteParticipant));
  };
  const onData = (payload: Uint8Array, from?: RemoteParticipant, kind?: unknown, topic?: string) =>
    quietly(receive(payload, from, kind, topic));
  room
    .on(RoomEvent.ParticipantDisconnected, onLeft)
    .on(RoomEvent.ParticipantConnected, onJoined)
    .on(RoomEvent.ParticipantAttributesChanged, onAttributes)
    .on(RoomEvent.DataReceived, onData);
  return () => {
    stopped = true;
    room
      .off(RoomEvent.ParticipantDisconnected, onLeft)
      .off(RoomEvent.ParticipantConnected, onJoined)
      .off(RoomEvent.ParticipantAttributesChanged, onAttributes)
      .off(RoomEvent.DataReceived, onData);
  };
}
