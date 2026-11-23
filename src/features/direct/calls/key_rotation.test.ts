import { describe, expect, it } from "vitest";
import { openCallKeyWith } from "./call_keys";
import { keeperOf, nextIndex, parseKeyMessage, sealKeyFor } from "./key_rotation";

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

  it("moves to the next key slot and wraps around LiveKit's ring", () => {
    expect(nextIndex(0)).toBe(1);
    expect(nextIndex(15)).toBe(0);
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
      index: 2,
      keys: { a: "x" },
    });
    expect(parseKeyMessage(encode({ index: 16, keys: {} }))).toBeUndefined();
    expect(parseKeyMessage(encode({ index: 1.5, keys: {} }))).toBeUndefined();
    expect(parseKeyMessage(encode({ index: 1 }))).toBeUndefined();
    expect(parseKeyMessage(new TextEncoder().encode("not json"))).toBeUndefined();
  });
});
