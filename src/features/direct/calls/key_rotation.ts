import {
  BaseKeyProvider,
  RoomEvent,
  createKeyMaterialFromBuffer,
  type Participant,
  type RemoteParticipant,
  type Room,
} from "livekit-client";
import { deviceCallKey, newCallKey, openCallKeyWith, sealCallKey } from "./call_keys";

export const keyTopic = "misty.call-key";
const keyIdAttribute = "misty.key-id";
const publicKeyAttribute = "misty.key";
const ringSize = 16;

export interface KeyMessage {
  index: number;
  keys: Record<string, string>;
}

export class CallKeyProvider extends BaseKeyProvider {
  constructor() {
    super({ sharedKey: true, ratchetWindowSize: 0, failureTolerance: -1, keyringSize: ringSize });
  }

  async setKeyAt(key: Uint8Array<ArrayBuffer>, index: number) {
    this.onSetEncryptionKey(await createKeyMaterialFromBuffer(key.buffer), undefined, index);
  }
}

export const nextIndex = (index: number) => (index + 1) % ringSize;

export function keeperOf(people: { identity: string; sid: string }[]) {
  return [...people].sort((a, b) =>
    a.identity === b.identity ? a.sid.localeCompare(b.sid) : a.identity.localeCompare(b.identity),
  )[0];
}

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

  const sealable = () =>
    [...room.remoteParticipants.values()].filter((person) => computerOf(person));
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
    if (computers.length)
      await send({ index: next.index, keys: await sealKeyFor(next.key, computers) });
    if (stopped) return;
    await provider.setKeyAt(next.key, next.index);
    current = next;
  };
  const welcome = async (person: RemoteParticipant) => {
    const computer = computerOf(person);
    if (stopped || !computer || current.index === 0 || !keeping()) return;
    await send({ index: current.index, keys: await sealKeyFor(current.key, [computer]) }, person);
  };
  const receive = async (
    payload: Uint8Array,
    from?: RemoteParticipant,
    _kind?: unknown,
    topic?: string,
  ) => {
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
