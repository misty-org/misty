import { EventEmitter } from "events";
import { ConnectionState, RoomEvent, type Room } from "livekit-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as CallKeys from "./call_keys";
import { deviceCallKey, openCallKeyWith } from "./call_keys";
import {
  CallKeyProvider,
  keeperOf,
  keyGroup,
  keyTopic,
  nearestEpoch,
  nextIndex,
  parseKeyMessage,
  sealKeyFor,
  slotOf,
  startKeyRotation,
  wireKeyMessage,
  type KeyMessage,
  type KeyRotation,
} from "./key_rotation";

vi.mock("./call_keys", async (importOriginal) => {
  const actual = await importOriginal<typeof CallKeys>();
  return { ...actual, deviceCallKey: vi.fn() };
});

const curve = { name: "ECDH", namedCurve: "P-256" } as const;

async function computer(keyId: string) {
  const pair = await crypto.subtle.generateKey(curve, false, ["deriveKey"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const publicKey = btoa(String.fromCharCode(...raw))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { keyId, publicKey, privateKey: pair.privateKey };
}

type Computer = Awaited<ReturnType<typeof computer>>;

const newKey = () => crypto.getRandomValues(new Uint8Array(32));

interface View {
  identity: string;
  sid: string;
  attributes: Record<string, string>;
}

class FakeRoom extends EventEmitter {
  state = ConnectionState.Connected;
  remoteParticipants = new Map<string, View>();
  localParticipant: View & {
    setAttributes(next: Record<string, string>): Promise<void>;
    publishData(
      payload: Uint8Array,
      options: { topic?: string; destinationIdentities?: string[] },
    ): Promise<void>;
  };

  constructor(net: FakeNet, identity: string) {
    super();
    const local = {
      identity,
      sid: `PA_${identity}`,
      attributes: {} as Record<string, string>,
      setAttributes: async (next: Record<string, string>) => {
        local.attributes = { ...local.attributes, ...next };
        const snapshot = { ...local.attributes };
        for (const other of net.others(identity))
          net.later(identity, other, () => {
            const view = other.remoteParticipants.get(identity);
            if (!view) return;
            view.attributes = { ...snapshot };
            other.emit(RoomEvent.ParticipantAttributesChanged, next, view);
          });
      },
      publishData: async (
        payload: Uint8Array,
        options: { topic?: string; destinationIdentities?: string[] },
      ) => {
        for (const other of net.others(identity)) {
          const to = other.localParticipant.identity;
          if (options.destinationIdentities && !options.destinationIdentities.includes(to))
            continue;
          net.later(identity, other, () => {
            const from = other.remoteParticipants.get(identity);
            if (from) other.emit(RoomEvent.DataReceived, payload, from, undefined, options.topic);
          });
        }
      },
    };
    this.localParticipant = local;
  }

  asRoom() {
    return this as unknown as Room;
  }
}

class FakeNet {
  rooms = new Map<string, FakeRoom>();
  muted = new Set<string>();

  add(identity: string) {
    const room = new FakeRoom(this, identity);
    this.rooms.set(identity, room);
    return room;
  }

  others(identity: string) {
    return [...this.rooms.values()].filter((room) => room.localParticipant.identity !== identity);
  }

  later(from: string, to: FakeRoom, deliver: () => void) {
    if (this.muted.has(from) || this.muted.has(to.localParticipant.identity)) return;
    setTimeout(deliver, 1);
  }

  link() {
    for (const room of this.rooms.values())
      for (const other of this.rooms.values()) {
        const identity = other.localParticipant.identity;
        if (room === other || room.remoteParticipants.has(identity)) continue;
        const view: View = {
          identity,
          sid: other.localParticipant.sid,
          attributes: { ...other.localParticipant.attributes },
        };
        room.remoteParticipants.set(identity, view);
        room.emit(RoomEvent.ParticipantConnected, view);
      }
  }

  leave(identity: string) {
    const gone = this.rooms.get(identity);
    this.rooms.delete(identity);
    if (gone) gone.state = ConnectionState.Disconnected;
    for (const room of this.rooms.values()) {
      const view = room.remoteParticipants.get(identity);
      if (!view) continue;
      room.remoteParticipants.delete(identity);
      room.emit(RoomEvent.ParticipantDisconnected, view);
    }
  }
}

const running: KeyRotation[] = [];

async function start(
  room: FakeRoom,
  device: Computer,
  firstKey: Uint8Array<ArrayBuffer>,
  base: (key: Uint8Array<ArrayBuffer>) => void = () => undefined,
) {
  const provider = new CallKeyProvider();
  await provider.remember(firstKey, 0);
  provider.use(0);
  vi.mocked(deviceCallKey).mockResolvedValueOnce(device);
  const rotation = await startKeyRotation(room.asRoom(), provider, firstKey, {
    keyed: () => undefined,
    base,
  });
  running.push(rotation);
  return { rotation, provider };
}

async function until(check: () => boolean, most = 8_000) {
  const end = Date.now() + most;
  while (!check()) {
    if (Date.now() > end) throw new Error("The call's keys didn't settle in time.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function inject(room: FakeRoom, message: KeyMessage, to?: string[]) {
  const payload = new TextEncoder().encode(JSON.stringify(wireKeyMessage(message)));
  return room.localParticipant.publishData(payload, {
    topic: keyTopic,
    ...(to ? { destinationIdentities: to } : {}),
  });
}

afterEach(() => {
  for (const rotation of running.splice(0)) rotation.stop();
  vi.mocked(deviceCallKey).mockReset();
});

describe("call key rotation", () => {
  it("lets exactly one person who stays hand out keys", () => {
    const people = [
      { identity: "carol", sid: "PA_3" },
      { identity: "ana", sid: "PA_9" },
      { identity: "bo", sid: "PA_1" },
    ];
    expect(keeperOf(people)?.identity).toBe("ana");
    expect(keeperOf([...people].reverse())?.identity).toBe("ana");
    expect(keeperOf([])).toBeUndefined();
  });

  it("moves to the next key slot and wraps around LiveKit's ring without reusing the first", () => {
    expect(nextIndex(0)).toBe(1);
    expect(nextIndex(14)).toBe(15);
    expect(nextIndex(15)).toBe(1);
    expect(slotOf(0)).toBe(0);
    expect(slotOf(1)).toBe(1);
    expect(slotOf(15)).toBe(15);
    expect(slotOf(16)).toBe(1);
    expect(slotOf(31)).toBe(1);
  });

  it("reads a slot as the newest turn of the ring near where the call is, so it never counts back", () => {
    expect(nearestEpoch(0, 40)).toBe(0);
    expect(nearestEpoch(1, 15)).toBe(16);
    expect(nearestEpoch(15, 16)).toBe(15);
    expect(nearestEpoch(2, 0)).toBe(2);
    for (let latest = 1; latest < 60; latest++) {
      const next = nearestEpoch(slotOf(latest + 1), latest + 1);
      expect(next).toBe(latest + 1);
    }
  });

  it("seals a new key so only the computers still in the call can open it", async () => {
    const bo = await computer("bo-mac");
    const carol = await computer("carol-pc");
    const leaver = await computer("dan-mac");
    const key = crypto.getRandomValues(new Uint8Array(32));
    const keys = await sealKeyFor(key, [bo, carol]);
    expect(Object.keys(keys).sort()).toEqual(["bo-mac", "carol-pc"]);
    expect(await openCallKeyWith(bo.privateKey, keys["bo-mac"]!)).toEqual(key);
    expect(await openCallKeyWith(carol.privateKey, keys["carol-pc"]!)).toEqual(key);
    expect(keys["dan-mac"]).toBeUndefined();
    await expect(openCallKeyWith(leaver.privateKey, keys["bo-mac"]!)).rejects.toThrow();
  });

  it("reads only well-formed key messages", () => {
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    expect(parseKeyMessage(encode({ index: 2, keys: { a: "x" } }))).toEqual({
      kind: "key",
      index: 2,
      keys: { a: "x" },
      switch: true,
    });
    expect(
      parseKeyMessage(encode({ index: 3, keys: { a: "x" }, switch: false, base: { a: "y" } })),
    ).toEqual({ kind: "key", index: 3, keys: { a: "x" }, switch: false, base: { a: "y" } });
    expect(
      parseKeyMessage(
        encode({
          index: 1,
          epoch: 16,
          keys: { a: "x" },
          group: "g",
          to: "bo",
          also: [{ index: 15, epoch: 15, keys: { a: "z" } }],
        }),
      ),
    ).toEqual({
      kind: "key",
      index: 1,
      epoch: 16,
      keys: { a: "x" },
      switch: true,
      group: "g",
      to: "bo",
      also: [{ index: 15, epoch: 15, keys: { a: "z" } }],
    });
    expect(parseKeyMessage(encode({ index: 1, epoch: 2, keys: { a: "x" } }))).toBeUndefined();
    expect(parseKeyMessage(encode({ use: 3 }))).toEqual({ kind: "use", index: 3 });
    expect(parseKeyMessage(encode({ use: 3, epoch: 18 }))).toEqual({
      kind: "use",
      index: 3,
      epoch: 18,
    });
    expect(parseKeyMessage(encode({ use: 3, epoch: 4 }))).toBeUndefined();
    expect(parseKeyMessage(encode({ ack: 3 }))).toEqual({ kind: "ack", index: 3 });
    expect(parseKeyMessage(encode({ ask: true, keyId: "k", publicKey: "p" }))).toEqual({
      kind: "ask",
      keyId: "k",
      publicKey: "p",
    });
    expect(parseKeyMessage(encode({ ask: true, keyId: "k", publicKey: "p", keyed: true }))).toEqual(
      { kind: "ask", keyId: "k", publicKey: "p", keyed: true },
    );
    expect(parseKeyMessage(encode({ ask: true, keyId: "", publicKey: "p" }))).toBeUndefined();
    expect(parseKeyMessage(encode({ index: 1, keys: { a: 2 } }))).toBeUndefined();
    expect(parseKeyMessage(encode({ index: 16, keys: {} }))).toBeUndefined();
    expect(parseKeyMessage(encode({ index: 1.5, keys: {} }))).toBeUndefined();
    expect(parseKeyMessage(encode({ index: 1 }))).toBeUndefined();
    expect(parseKeyMessage(new TextEncoder().encode("not json"))).toBeUndefined();
  });

  it("settles two people who started a call at once with their own first keys on the lower one's", async () => {
    const net = new FakeNet();
    const ana = net.add("ana");
    const bo = net.add("bo");
    const anaKey = newKey();
    const boKey = newKey();
    const anaBase = vi.fn();
    const boBase = vi.fn();
    const a = await start(ana, await computer("ana-mac"), anaKey, anaBase);
    const b = await start(bo, await computer("bo-mac"), boKey, boBase);
    const anaGroup = await keyGroup(anaKey);
    expect(a.rotation.group).toBe(anaGroup);
    expect(b.rotation.group).not.toBe(anaGroup);

    net.link();
    await until(
      () =>
        b.rotation.group === anaGroup &&
        ana.remoteParticipants.get("bo")?.attributes["misty.key-group"] === anaGroup,
    );
    await pause(50);

    expect(a.rotation.group).toBe(anaGroup);
    expect(b.rotation.group).toBe(anaGroup);
    expect(a.rotation.epoch).toBe(b.rotation.epoch);
    expect(boBase).toHaveBeenCalledWith(anaKey);
    expect(anaBase).not.toHaveBeenCalled();
    expect(bo.localParticipant.attributes["misty.keyed"]).toBe("1");
  });

  it("never moves the newest key back, even when an old key comes again", async () => {
    const net = new FakeNet();
    const shared = newKey();
    const ana = net.add("ana");
    const bo = net.add("bo");
    const cy = net.add("cy");
    const boComputer = await computer("bo-mac");
    const a = await start(ana, await computer("ana-mac"), shared);
    const b = await start(bo, boComputer, shared);
    await start(cy, await computer("cy-mac"), shared);
    net.link();
    await until(() => ana.remoteParticipants.get("bo")?.attributes["misty.keyed"] === "1");

    net.leave("cy");
    await until(() => a.rotation.epoch === 1 && b.rotation.epoch === 1);
    expect(b.rotation.latest).toBe(1);

    await inject(
      ana,
      {
        kind: "key",
        index: 0,
        epoch: 0,
        keys: await sealKeyFor(shared, [boComputer]),
        switch: true,
        group: a.rotation.group,
        to: "bo",
      },
      ["bo"],
    );
    await inject(ana, { kind: "use", index: 0, epoch: 0 }, ["bo"]);
    await pause(200);

    expect(b.rotation.epoch).toBe(1);
    expect(b.rotation.latest).toBe(1);
    expect(b.provider.index).toBe(1);
  }, 20_000);

  it("waits for a key before acting on the word to use it", async () => {
    const net = new FakeNet();
    const shared = newKey();
    const ana = net.add("ana");
    const bo = net.add("bo");
    const boComputer = await computer("bo-mac");
    const a = await start(ana, await computer("ana-mac"), shared);
    const b = await start(bo, boComputer, shared);
    net.link();
    await until(() => ana.remoteParticipants.get("bo")?.attributes["misty.keyed"] === "1");

    const next = newKey();
    const keys = await sealKeyFor(next, [boComputer]);
    void inject(ana, {
      kind: "key",
      index: 1,
      epoch: 1,
      keys,
      switch: false,
      group: a.rotation.group,
    });
    void inject(ana, { kind: "use", index: 1, epoch: 1 });

    await until(() => b.rotation.epoch === 1);
    expect(b.provider.index).toBe(1);
    expect(b.rotation.latest).toBe(1);
  });

  it("gives someone who joins every key the people in the call are still using", async () => {
    const net = new FakeNet();
    const shared = newKey();
    const ana = net.add("ana");
    const bo = net.add("bo");
    const cy = net.add("cy");
    const dan = net.add("dan");
    const fay = net.add("fay");
    const a = await start(ana, await computer("ana-mac"), shared);
    const b = await start(bo, await computer("bo-mac"), shared);
    const c = await start(cy, await computer("cy-mac"), shared);
    await start(dan, await computer("dan-mac"), shared);
    await start(fay, await computer("fay-mac"), shared);
    net.link();
    await until(() =>
      ["bo", "cy", "dan", "fay"].every(
        (identity) => ana.remoteParticipants.get(identity)?.attributes["misty.keyed"] === "1",
      ),
    );

    net.leave("dan");
    await until(
      () =>
        a.rotation.epoch === 1 &&
        b.rotation.epoch === 1 &&
        c.rotation.epoch === 1 &&
        ana.remoteParticipants.get("cy")?.attributes["misty.key-epoch"] === "1",
    );

    net.muted.add("cy");
    net.leave("fay");
    await until(() => a.rotation.epoch === 2 && b.rotation.epoch === 2);
    expect(c.rotation.epoch).toBe(1);
    expect(ana.remoteParticipants.get("cy")?.attributes["misty.key-epoch"]).toBe("1");

    const eve = net.add("eve");
    net.link();
    const e = await start(eve, await computer("eve-mac"), shared);
    await until(() => e.rotation.epoch === 2);

    expect(e.provider.has(0)).toBe(true);
    expect(e.provider.has(1)).toBe(true);
    expect(e.provider.has(2)).toBe(true);
    expect(e.provider.index).toBe(2);
    expect(e.rotation.keyed).toBe(true);
  }, 30_000);

  it("hands no key to someone who leaves within a second of joining", async () => {
    const net = new FakeNet();
    const shared = newKey();
    const ana = net.add("ana");
    const a = await start(ana, await computer("ana-mac"), shared);
    expect(a.rotation.keyed).toBe(true);
    const sent = vi.spyOn(ana.localParticipant, "publishData");

    const eve = net.add("eve");
    net.link();
    await start(eve, await computer("eve-mac"), shared);
    await pause(200);
    net.leave("eve");
    await pause(1_500);

    const keysForEve = sent.mock.calls.filter(([payload, options]) => {
      const message = parseKeyMessage(payload);
      return (
        message?.kind === "key" &&
        (message.to === "eve" || Boolean(options.destinationIdentities?.includes("eve")))
      );
    });
    expect(keysForEve).toEqual([]);
  }, 10_000);

  it("settles two people who each saw the other on joining on one keeper, then rotates and welcomes", async () => {
    const net = new FakeNet();
    const ana = net.add("ana");
    const bo = net.add("bo");
    const anaKey = newKey();
    const anaComputer = await computer("ana-mac");
    const boComputer = await computer("bo-mac");
    net.link();
    const a = await start(ana, anaComputer, anaKey);
    const b = await start(bo, boComputer, newKey());
    expect(a.rotation.keyed).toBe(false);
    expect(b.rotation.keyed).toBe(false);
    const anaGroup = await keyGroup(anaKey);

    await until(
      () =>
        a.rotation.group === anaGroup &&
        b.rotation.group === anaGroup &&
        ana.localParticipant.attributes["misty.keyed"] === "1" &&
        bo.localParticipant.attributes["misty.keyed"] === "1" &&
        ana.remoteParticipants.get("bo")?.attributes["misty.key-group"] === anaGroup,
      12_000,
    );
    expect(a.rotation.epoch).toBe(b.rotation.epoch);

    const cy = net.add("cy");
    net.link();
    const c = await start(cy, await computer("cy-mac"), newKey());
    await until(
      () =>
        c.rotation.group === anaGroup &&
        cy.localParticipant.attributes["misty.keyed"] === "1" &&
        ana.remoteParticipants.get("cy")?.attributes["misty.keyed"] === "1",
    );

    net.leave("cy");
    await until(() => a.rotation.epoch === 1 && b.rotation.epoch === 1);
    expect(a.provider.index).toBe(1);
    expect(b.provider.index).toBe(1);
    expect(b.rotation.group).toBe(anaGroup);
  }, 40_000);

  it("takes the keeper's word to use someone else's key only while the keeper is in the same group", async () => {
    const net = new FakeNet();
    const shared = newKey();
    const ana = net.add("ana");
    const bo = net.add("bo");
    const cy = net.add("cy");
    const boComputer = await computer("bo-mac");
    await start(ana, await computer("ana-mac"), shared);
    const b = await start(bo, boComputer, shared);
    await start(cy, await computer("cy-mac"), shared);
    net.link();
    await until(
      () =>
        bo.remoteParticipants.get("ana")?.attributes["misty.keyed"] === "1" &&
        bo.remoteParticipants.get("cy")?.attributes["misty.keyed"] === "1",
    );

    await inject(
      cy,
      {
        kind: "key",
        index: 1,
        epoch: 1,
        keys: await sealKeyFor(newKey(), [boComputer]),
        switch: false,
        group: b.rotation.group,
      },
      ["bo"],
    );
    await until(() => b.rotation.latest === 1);

    await ana.localParticipant.setAttributes({ "misty.key-group": "elsewhere" });
    await until(
      () => bo.remoteParticipants.get("ana")?.attributes["misty.key-group"] === "elsewhere",
    );
    await inject(ana, { kind: "use", index: 1, epoch: 1 }, ["bo"]);
    await pause(100);
    expect(b.rotation.epoch).toBe(0);

    await ana.localParticipant.setAttributes({ "misty.key-group": b.rotation.group });
    await until(
      () => bo.remoteParticipants.get("ana")?.attributes["misty.key-group"] === b.rotation.group,
    );
    await inject(ana, { kind: "use", index: 1, epoch: 1 }, ["bo"]);
    await until(() => b.rotation.epoch === 1);
  });

  it("sets every key it holds again for whoever's frames failed", async () => {
    const net = new FakeNet();
    const shared = newKey();
    const ana = net.add("ana");
    const bo = net.add("bo");
    const a = await start(ana, await computer("ana-mac"), shared);
    await start(bo, await computer("bo-mac"), shared);
    net.link();
    await until(() => ana.remoteParticipants.get("bo")?.attributes["misty.keyed"] === "1");

    const provider = a.provider as unknown as {
      onSetEncryptionKey(key: CryptoKey, identity?: string, index?: number): void;
    };
    const set = vi.spyOn(provider, "onSetEncryptionKey");
    a.rotation.refresh();
    expect(set).toHaveBeenCalledWith(expect.anything(), "bo", 0);
    set.mockClear();
    a.rotation.refresh("bo");
    expect(set).toHaveBeenCalledWith(expect.anything(), "bo", 0);
    set.mockClear();
    a.rotation.refresh("ana");
    expect(set).toHaveBeenCalledWith(expect.anything(), "ana", 0);
  });
});
