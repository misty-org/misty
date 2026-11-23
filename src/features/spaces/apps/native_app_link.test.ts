import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import { coalesceAwareness, mergeAwareness, refsIn, SDK_LANE } from "./native_app_link";

function awarenessWith(client: number) {
  const doc = new Y.Doc();
  doc.clientID = client;
  return new Awareness(doc);
}

describe("app page awareness", () => {
  it("keeps each client's latest state when updates merge", () => {
    const ana = awarenessWith(1);
    const sam = awarenessWith(2);
    ana.setLocalState({ x: 1 });
    const first = encodeAwarenessUpdate(ana, [1]);
    sam.setLocalState({ x: 5 });
    const other = encodeAwarenessUpdate(sam, [2]);
    ana.setLocalState({ x: 2 });
    const second = encodeAwarenessUpdate(ana, [1]);

    const reader = awarenessWith(9);
    applyAwarenessUpdate(reader, mergeAwareness([first, other, second]), "test");
    expect(reader.getStates().get(1)).toEqual({ x: 2 });
    expect(reader.getStates().get(2)).toEqual({ x: 5 });
  });

  it("sends one awareness event per subscription in a frame and leaves the rest in order", () => {
    const ana = awarenessWith(1);
    ana.setLocalState({ x: 1 });
    const first = encodeAwarenessUpdate(ana, [1]);
    ana.setLocalState({ x: 2 });
    const second = encodeAwarenessUpdate(ana, [1]);
    const sync = { t: "evt", id: 4, data: { type: "sync", update: new Uint8Array([1]) } };
    const batch: [string, unknown][] = [
      [SDK_LANE, { t: "evt", id: 4, data: { type: "awareness", update: first } }],
      [SDK_LANE, sync],
      [SDK_LANE, { t: "evt", id: 4, data: { type: "awareness", update: second } }],
      ["misty:screen", { t: "cmd", id: 1, name: "read" }],
    ];
    const out = coalesceAwareness(batch);
    expect(out).toHaveLength(3);
    expect(out[0]![1]).toBe(sync);
    const merged = out[1]![1] as { data: { update: Uint8Array } };
    const reader = awarenessWith(9);
    applyAwarenessUpdate(reader, merged.data.update, "test");
    expect(reader.getStates().get(1)).toEqual({ x: 2 });
    expect(out[2]![0]).toBe("misty:screen");
  });
});

describe("refsIn", () => {
  it("finds every byte reference a frame carries, however deep", () => {
    expect(
      refsIn({
        t: "evt",
        data: [
          { $mistyBytes: "", r: "a", k: "Uint8Array" },
          { inner: { $mistyBytes: "AA==", k: "Uint8Array" } },
        ],
        more: { $mistyBytes: "", r: "b", k: "ArrayBuffer" },
      }),
    ).toEqual(["a", "b"]);
  });
});
