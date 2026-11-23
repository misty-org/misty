import * as Y from "yjs";

export const FILE_META = "misty:file";
export const FILE_TEXT = "text";

const base64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export const base64Of = base64;

export const snapshotOf = (doc: Y.Doc) => Y.encodeSnapshot(Y.snapshot(doc));

export async function fingerprintOf(snapshot: Uint8Array): Promise<string> {
  return base64(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(snapshot))));
}

export const sameBytes = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);

export function liveText(data: ArrayBuffer): string | null {
  const view = new Uint8Array(data);
  if (view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(view);
  } catch {
    return null;
  }
  return text.includes("\r") ? null : text;
}

interface MetaMark {
  client: number;
  clock: number;
  length: number;
  key: string;
}

export interface MetaWrite {
  touches: boolean;
  loads: boolean;
  loadedTo: unknown;
}

const MIXED_LOAD = Symbol("mixed-load");

function keyIn(meta: Y.Map<unknown>, item: Y.Item): string | undefined {
  for (let at: Y.Item | null = item; at; ) {
    const parent: unknown = at.parent;
    if (parent === meta) return at.parentSub ?? "";
    at = parent instanceof Y.AbstractType ? parent._item : null;
  }
  return undefined;
}

function keyOf(doc: Y.Doc, meta: Y.Map<unknown>, marks: MetaMark[], id: Y.ID | null): string | null | undefined {
  if (id === null) return undefined;
  if (id.clock < Y.getState(doc.store, id.client)) {
    const item = Y.getItem(doc.store, id) as unknown;
    return item instanceof Y.Item ? (keyIn(meta, item) ?? null) : null;
  }
  return marks.find((mark) => mark.client === id.client && id.clock >= mark.clock && id.clock < mark.clock + mark.length)?.key;
}

type Decoded = ReturnType<typeof Y.decodeUpdate>;

const deletedBy = (ds: Decoded["ds"], id: Y.ID) =>
  (ds.clients.get(id.client) ?? []).some((range) => id.clock >= range.clock && id.clock < range.clock + range.len);

function loadedValue(decoded: Decoded, items: Y.Item[]): unknown {
  let value: unknown = MIXED_LOAD;
  for (const item of items) {
    const content = item.content;
    if (!(content instanceof Y.ContentAny) || content.arr.length !== 1 || deletedBy(decoded.ds, item.id)) return MIXED_LOAD;
    if (value !== MIXED_LOAD && value !== content.arr[0]) return MIXED_LOAD;
    value = content.arr[0];
  }
  return value;
}

export function metaWrite(doc: Y.Doc, meta: Y.Map<unknown>, update: Uint8Array): MetaWrite | null {
  let decoded: Decoded;
  try {
    decoded = Y.decodeUpdate(update);
  } catch {
    return null;
  }
  const marks: MetaMark[] = [];
  let left = decoded.structs.filter(
    (struct): struct is Y.Item =>
      struct instanceof Y.Item && struct.id.clock + struct.length > Y.getState(doc.store, struct.id.client),
  );
  const keys = new Set<string>();
  const loads: Y.Item[] = [];
  for (let grew = true; grew && left.length > 0; ) {
    grew = false;
    const rest: Y.Item[] = [];
    for (const struct of left) {
      const parent = struct.parent as unknown;
      const key =
        typeof parent === "string"
          ? parent === FILE_META
            ? (struct.parentSub ?? "")
            : null
          : parent instanceof Y.ID
            ? keyOf(doc, meta, marks, parent)
            : (keyOf(doc, meta, marks, struct.origin) ?? keyOf(doc, meta, marks, struct.rightOrigin));
      if (key === undefined) {
        rest.push(struct);
        continue;
      }
      grew = true;
      if (key === null) continue;
      keys.add(key);
      if (key === "loaded") loads.push(struct);
      marks.push({ client: struct.id.client, clock: struct.id.clock, length: struct.length, key });
    }
    left = rest;
  }
  let touches = [...keys].some((key) => key !== "loaded");
  for (const item of meta._map.values()) if (!touches && !item.deleted && deletedBy(decoded.ds, item.id)) touches = true;
  return { touches, loads: loads.length > 0, loadedTo: loadedValue(decoded, loads) };
}
