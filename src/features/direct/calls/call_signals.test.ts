import { EventEmitter } from "events";
import { RoomEvent, type Room } from "livekit-client";
import { expect, it, vi } from "vitest";
import { CallSignals } from "./call_signals";

class FakeRoom extends EventEmitter {
  peers: FakeRoom[] = [];
  localParticipant: {
    identity: string;
    publishData(payload: Uint8Array, options: { topic?: string }): Promise<void>;
  };

  constructor(identity: string) {
    super();
    this.localParticipant = {
      identity,
      publishData: async (payload, options) => {
        for (const peer of this.peers)
          peer.emit(RoomEvent.DataReceived, payload, { identity }, undefined, options.topic);
      },
    };
  }
}

const newKey = () => crypto.getRandomValues(new Uint8Array(32));

function pair(key: Uint8Array<ArrayBuffer>, mayModerate?: (identity: string) => boolean) {
  const ana = new FakeRoom("ana");
  const ben = new FakeRoom("ben");
  ana.peers = [ben];
  ben.peers = [ana];
  const events = () => ({ changed: vi.fn(), lowered: vi.fn(), muted: vi.fn() });
  const anaEvents = events();
  const benEvents = events();
  const anaSignals = new CallSignals(ana as unknown as Room, key, anaEvents);
  const benSignals = new CallSignals(ben as unknown as Room, key, benEvents, mayModerate);
  return { anaSignals, benSignals, anaEvents, benEvents };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

it("takes a mute or a lowered hand only from someone who may moderate", async () => {
  const key = newKey();
  const nobody = pair(key);
  nobody.benSignals.setHand(true);
  nobody.anaSignals.tellMuted("ben");
  nobody.anaSignals.lowerHandOf("ben");
  await settle();
  expect(nobody.benEvents.muted).not.toHaveBeenCalled();
  expect(nobody.benEvents.lowered).not.toHaveBeenCalled();

  const moderated = pair(key, (identity) => identity === "ana");
  moderated.benSignals.setHand(true);
  moderated.anaSignals.tellMuted("ben");
  moderated.anaSignals.lowerHandOf("ben");
  await settle();
  expect(moderated.benEvents.muted).toHaveBeenCalledTimes(1);
  expect(moderated.benEvents.lowered).toHaveBeenCalledTimes(1);
});

it("keeps hearing signals across a key change, from either side of it", async () => {
  const { anaSignals, benSignals } = pair(newKey());
  const next = newKey();
  benSignals.setKey(next);
  anaSignals.setHand(true);
  await settle();
  expect(benSignals.current().hands.has("ana")).toBe(true);
  anaSignals.setKey(next);
  anaSignals.setDeaf(true);
  await settle();
  expect(benSignals.current().deaf.has("ana")).toBe(true);
});

it("after moving to another key, says its own state again and asks the others for theirs", async () => {
  const ana = new FakeRoom("ana");
  const ben = new FakeRoom("ben");
  ana.peers = [ben];
  ben.peers = [ana];
  const events = () => ({ changed: vi.fn(), lowered: vi.fn(), muted: vi.fn() });
  const benKey = newKey();
  const anaSignals = new CallSignals(ana as unknown as Room, newKey(), events());
  const benSignals = new CallSignals(ben as unknown as Room, benKey, events());
  anaSignals.setHand(true);
  benSignals.setDeaf(true);
  await settle();
  expect(benSignals.current().hands.has("ana")).toBe(false);
  expect(anaSignals.current().deaf.has("ben")).toBe(false);
  anaSignals.setKey(benKey);
  await settle();
  expect(benSignals.current().hands.has("ana")).toBe(true);
  expect(anaSignals.current().deaf.has("ben")).toBe(true);
});
