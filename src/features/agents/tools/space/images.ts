import { invoke } from "@tauri-apps/api/core";
import {
  ImageChangeRejected,
  applyImageChanges,
  canRemoveBackground,
  canvasToBlob,
  clearImageEdit,
  defaultImageEdit,
  imageDocParts,
  loadPhoto,
  outputSize,
  readImageEdit,
  removeBackground,
  renderEdit,
  writeImageEdit,
  type ImageDocParts,
  type ImageEdit,
  type ImagePeerState,
  type Mark,
} from "@/features/files";
import { spacesGateway, type LiveLibraryImage } from "../../spaces-gateway/spacesGateway";
import { agentTag } from "../../tutor/agentTag";
import { LocalToolRejected, type LocalToolHandler, type LocalToolRequest } from "../host";
import { loadRunEntry } from "../runContexts";
import { refuse } from "./api";
import { integer, text, textList } from "./args";
import { routedTool, type SpaceRow } from "./routing";

/**
 * An agent editing a Space Library image works in the same live edit as the people who have it
 * open: it joins the image's room, shows there as itself while it works, and its changes land in
 * front of everyone, who can undo them. Nothing reaches the image file until a save, a cutout or
 * a file of the agent's own saved over it.
 */

/** How long to wait for the room's copy of the edit before giving up. */
const syncWaitMs = 8000;
/** How long the agent stays visible in the room after a change, so people see who made it. */
const lingerMs = 1200;
/** The most images one edit changes, and how many rooms it has open at once. */
const batchMost = 50;
const batchAtOnce = 4;

const UNAVAILABLE =
  "Live image editing isn't available here: the Space's server doesn't support it yet, or the image can't be reached.";
const VIEW_ONLY = "This image can only be viewed here, not edited.";
const NO_CUTOUT =
  "This computer can't remove backgrounds: it needs a Mac with macOS 14 or later, and the Misty app.";
const NOT_AN_IMAGE = "That file isn't a PNG, JPEG, WebP or GIF image.";

const itemId = (input: Record<string, unknown>) => {
  const id = text(input, "item_id", { max: 200 }).trim();
  if (!id) throw refuse("item_id is required");
  return id;
};

async function agentPerson(request: LocalToolRequest): Promise<ImagePeerState["user"]> {
  const run = await loadRunEntry(request.runId).catch(() => null);
  const name = run?.agentId ? agentTag(run.agentId).name : "Agent";
  return { id: `agent:${run?.agentId || request.runId}`, name, tone: "teal", agent: true };
}

/** Opens the image's live edit for the length of `work`, and always lets it go after. */
async function withImage<T>(
  space: SpaceRow,
  id: string,
  work: (image: LiveLibraryImage) => Promise<T>,
): Promise<T> {
  const gateway = spacesGateway.maybe();
  if (!gateway) throw refuse(UNAVAILABLE, "unavailable");
  let image: LiveLibraryImage;
  try {
    image = await gateway.openLibraryImage(space.id, id);
  } catch (error) {
    if (error instanceof Error && error.message === "This Library item isn't an image.")
      throw refuse(error.message);
    throw refuse(UNAVAILABLE, "unavailable");
  }
  try {
    let timer = 0;
    const reached = await Promise.race([
      image.synced.then(() => true),
      new Promise<false>((resolve) => {
        timer = window.setTimeout(() => resolve(false), syncWaitMs);
      }),
    ]);
    window.clearTimeout(timer);
    if (!reached) throw refuse(UNAVAILABLE, "unavailable");
    return await work(image);
  } finally {
    image.close();
  }
}

/** Who is in the image's editor now, by name. */
function editingNow(image: LiveLibraryImage): string[] {
  const names = new Set<string>();
  image.awareness.getStates().forEach((state, clientId) => {
    if (clientId === image.awareness.clientID) return;
    const user = (state as Partial<ImagePeerState>).user;
    if (user && typeof user.name === "string")
      names.add(user.agent ? `${user.name} (agent)` : user.name);
  });
  return [...names];
}

const round = (value: number, places = 4) => Number(value.toFixed(places));

/** The edit as the model reads it: what differs from the image as saved, in plain fields. */
function describe(image: LiveLibraryImage, edit: ImageEdit) {
  const natural = { width: image.width, height: image.height };
  const known = natural.width > 0 && natural.height > 0;
  const adjust = Object.fromEntries(Object.entries(edit.adjust).filter(([, value]) => value !== 0));
  const marks = Object.values(edit.marks)
    .sort((a, b) => a.z - b.z)
    .map((mark) => {
      const { z: _z, ...rest } = mark;
      return roundMark(rest);
    });
  return {
    name: image.name,
    size: known ? natural : null,
    saves_at: known ? outputSize(natural, edit) : null,
    edit: {
      rotation: edit.rotation,
      flip: [edit.flipX ? "horizontal" : null, edit.flipY ? "vertical" : null].filter(Boolean),
      straighten: edit.straighten,
      crop: Object.fromEntries(
        Object.entries(edit.crop).map(([key, value]) => [key, round(value)]),
      ),
      aspect: edit.aspect,
      adjust,
      filter: edit.filter,
      filter_strength: edit.filterStrength,
      resize: edit.resize,
    },
    marks,
    unsaved_changes: JSON.stringify(edit) !== JSON.stringify(defaultImageEdit),
    editing_now: editingNow(image),
  };
}

function roundMark(mark: Omit<Mark, "z">): Record<string, unknown> {
  return JSON.parse(JSON.stringify(mark), (_key, value) =>
    typeof value === "number" ? round(value) : value,
  ) as Record<string, unknown>;
}

const read = routedTool("read", async (request, space) =>
  withImage(space, itemId(request.input), async (image) =>
    describe(image, readImageEdit(imageDocParts(image.doc))),
  ),
);

/** What the edit tool reads itself, beside the change. */
const editTargets = ["item_id", "item_ids", "space"] as const;

/** The model's change applied to an edit; a malformed one is refused with what was wrong. */
function changed(
  current: ImageEdit,
  input: Record<string, unknown>,
  author: string,
  natural: { width: number; height: number } | null,
): ImageEdit {
  try {
    return applyImageChanges(current, input, { author, natural, ignore: editTargets });
  } catch (error) {
    if (error instanceof ImageChangeRejected) throw refuse(error.message);
    throw error;
  }
}

/** Where the agent's pointer rests while it is in the room: on what it just added, or the middle. */
function pointerFor(before: ImageEdit, after: ImageEdit) {
  const added = Object.values(after.marks).find((mark) => !before.marks[mark.id]);
  if (!added) return null;
  switch (added.kind) {
    case "pen":
      return added.points[0];
    case "line":
    case "arrow":
      return added.to;
    case "text":
      return added.at;
    default:
      return { x: added.box.x + added.box.width, y: added.box.y + added.box.height };
  }
}

/**
 * The original's size, for a change that crops to an aspect: from the Library when it knows, else
 * read from the image itself.
 */
async function naturalSize(image: LiveLibraryImage, input: Record<string, unknown>) {
  if (image.width > 0 && image.height > 0) return { width: image.width, height: image.height };
  if (input.aspect === undefined || input.crop !== undefined) return null;
  const photo = await loadPhoto(await image.original());
  return { width: photo.width, height: photo.height };
}

async function editOne(
  request: LocalToolRequest,
  space: SpaceRow,
  id: string,
  me: ImagePeerState["user"],
) {
  return withImage(space, id, async (image) => {
    if (image.role === "viewer") throw refuse(VIEW_ONLY, "not_allowed");
    const parts = imageDocParts(image.doc);
    const before = readImageEdit(parts);
    const after = changed(before, request.input, me.name, await naturalSize(image, request.input));
    // The agent shows in the editor as itself while its change lands, then leaves.
    image.awareness.setLocalState({
      user: me,
      pointer: pointerFor(before, after),
      selection: [],
      draft: null,
    });
    writeImageEdit(parts, after, { image: "agent" });
    await new Promise((resolve) => window.setTimeout(resolve, lingerMs));
    image.awareness.setLocalState(null);
    return describe(image, readImageEdit(parts));
  });
}

/** The images one edit is for: `item_id`, or 1 to 50 `item_ids` (each once, in their order). */
function editItems(input: Record<string, unknown>): { one: string } | { many: string[] } {
  const many = textList(input, "item_ids", { min: 1, max: batchMost, itemMin: 1, itemMax: 200 });
  const one = text(input, "item_id", { max: 200 }).trim();
  if (many && one) throw refuse("pass item_id or item_ids, not both");
  if (many) return { many: [...new Set(many.map((id) => id.trim()).filter(Boolean))] };
  if (!one) throw refuse("item_id or item_ids is required");
  return { one };
}

/** Runs `work` over every item, a few at a time, answering in the items' order. */
async function eachInTurn<T>(ids: string[], work: (id: string) => Promise<T>): Promise<T[]> {
  const results = new Array<T>(ids.length);
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const index = next++;
      results[index] = await work(ids[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(batchAtOnce, ids.length) }, worker));
  return results;
}

const edit = routedTool("change", async (request, space) => {
  const items = editItems(request.input);
  const me = await agentPerson(request);
  // A change that can't apply is refused before any image is touched.
  changed(defaultImageEdit, request.input, me.name, null);
  if ("one" in items) return editOne(request, space, items.one, me);
  // Each image on its own: one that fails is reported and the rest still change.
  const results = await eachInTurn(items.many, async (id) => {
    try {
      return { item_id: id, ...(await editOne(request, space, id, me)) };
    } catch (error) {
      const code = error instanceof LocalToolRejected ? error.code : "failed";
      const message =
        error instanceof Error && error.message ? error.message : "This image couldn't be changed.";
      return { item_id: id, error: { code, message } };
    }
  });
  const failed = results.filter((result) => "error" in result).length;
  return { edited: results.length - failed, failed, results };
});

// ---------------------------------------------------------------------------------------------
// Saving

const formats = {
  png: { mimeType: "image/png", extension: "png" },
  jpeg: { mimeType: "image/jpeg", extension: "jpg" },
  webp: { mimeType: "image/webp", extension: "webp" },
} as const;
type FormatId = keyof typeof formats;

const extensionOf = (mimeType: string) =>
  mimeType === "image/jpeg"
    ? "jpg"
    : mimeType === "image/webp"
      ? "webp"
      : mimeType === "image/gif"
        ? "gif"
        : "png";

const stemOf = (name: string) => name.replace(/\.[^./\\]+$/, "") || "image";

/** What an image file is, by the first bytes of it, never by its name. */
export function imageFileKind(bytes: Uint8Array): { mimeType: string; extension: string } | null {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const ascii = (from: number, word: string) =>
    [...word].every((letter, index) => bytes[from + index] === letter.charCodeAt(0));
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
    return { mimeType: "image/png", extension: "png" };
  if (starts(0xff, 0xd8, 0xff)) return { mimeType: "image/jpeg", extension: "jpg" };
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return { mimeType: "image/gif", extension: "gif" };
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return { mimeType: "image/webp", extension: "webp" };
  return null;
}

/** An image file the agent's own tools made in the chat's folder. Only a chat's agent has one. */
async function chatImage(request: LocalToolRequest, path: string): Promise<Blob> {
  const run = await loadRunEntry(request.runId).catch(() => null);
  if (!run?.conversationId)
    throw refuse("Only a chat's agent has a folder to save an image from.", "not_allowed");
  let loaded: ArrayBuffer | number[];
  try {
    loaded = await invoke<ArrayBuffer | number[]>("chat_media_load", {
      account: run.account,
      conversation: run.conversationId,
      path,
    });
  } catch (error) {
    throw refuse(typeof error === "string" ? error : "That file can't be read.");
  }
  const bytes = loaded instanceof ArrayBuffer ? new Uint8Array(loaded) : Uint8Array.from(loaded);
  const kind = imageFileKind(bytes);
  if (!kind) throw refuse(NOT_AN_IMAGE);
  return new Blob([bytes], { type: kind.mimeType });
}

/** The format and quality `image.save` was asked for, if any. */
function saveFormat(input: Record<string, unknown>) {
  const format = text(input, "format", { allowed: Object.keys(formats) }) as FormatId | "";
  const quality = integer(input, "quality", 1, 100);
  return { format: format ? formats[format] : null, quality: quality ? quality / 100 : undefined };
}

/** An image file in another format, drawn again. */
async function reencoded(file: Blob, mimeType: string, quality?: number): Promise<Blob> {
  const photo = await loadPhoto(file);
  const canvas = document.createElement("canvas");
  canvas.width = photo.width;
  canvas.height = photo.height;
  canvas.getContext("2d")?.drawImage(photo.image, 0, 0, photo.width, photo.height);
  return canvasToBlob(canvas, mimeType, quality);
}

/** The image with its live edit, at full size, its stickers loaded. */
async function renderLive(image: LiveLibraryImage, parts: ImageDocParts) {
  return renderEdit(await loadPhoto(await image.original()), readImageEdit(parts));
}

/**
 * Keeps an image made from the item: over it as a new version, where the live edit starts again
 * from it, or beside it as a new item named `name`, else `fallback`.
 */
async function keep(
  image: LiveLibraryImage,
  parts: ImageDocParts,
  blob: Blob,
  mode: string,
  name: string,
  fallback: string,
) {
  if (mode === "replace") {
    const version = await image.replace(blob);
    // The edit is in the image now: everyone starts again from the saved image.
    clearImageEdit(parts, String(version), { image: "saved" });
    return { saved: "replaced", name: image.name, version };
  }
  const stem = (name || fallback).replace(/\.(png|jpe?g|webp|gif)$/i, "");
  const filename = `${stem}.${extensionOf(blob.type)}`;
  const created = await image.saveCopy(blob, filename);
  return { saved: "copy", name: filename, item_id: created?.id ?? null };
}

const save = routedTool("change", async (request, space) => {
  const mode = text(request.input, "mode", { required: true, allowed: ["replace", "copy"] });
  const name = text(request.input, "name", { min: 1, max: 200 }).trim();
  const path = text(request.input, "path", { min: 1, max: 4000 }).trim();
  const { format, quality } = saveFormat(request.input);
  const id = itemId(request.input);
  // The agent's own file is read first, so a wrong one is refused before the room opens.
  const file = path ? await chatImage(request, path) : null;
  return withImage(space, id, async (image) => {
    if (image.role === "viewer") throw refuse(VIEW_ONLY, "not_allowed");
    const parts = imageDocParts(image.doc);
    let blob: Blob;
    if (file) blob = format ? await reencoded(file, format.mimeType, quality) : file;
    else {
      const own = Object.values(formats).find((known) => known.mimeType === image.mimeType);
      const mimeType = (format ?? own ?? formats.png).mimeType;
      blob = await canvasToBlob(await renderLive(image, parts), mimeType, quality);
    }
    return keep(image, parts, blob, mode, name, `${stemOf(image.name)} edited`);
  });
});

/**
 * The background taken out on this computer, as the Remove background tab does: the image with
 * its live edit, with only its subject left over transparency, as a PNG.
 */
const cutout = routedTool("change", async (request, space) => {
  const mode = text(request.input, "mode", { required: true, allowed: ["replace", "copy"] });
  const name = text(request.input, "name", { min: 1, max: 200 }).trim();
  const id = itemId(request.input);
  if (!(await canRemoveBackground())) throw refuse(NO_CUTOUT, "unavailable");
  return withImage(space, id, async (image) => {
    if (image.role === "viewer") throw refuse(VIEW_ONLY, "not_allowed");
    const parts = imageDocParts(image.doc);
    const rendered = await canvasToBlob(await renderLive(image, parts), "image/png");
    let made: Blob;
    try {
      made = await removeBackground(rendered);
    } catch (error) {
      throw refuse(error instanceof Error ? error.message : "The background couldn't be removed.");
    }
    return keep(image, parts, made, mode, name, `${stemOf(image.name)} (no background)`);
  });
});

/** How wide an image an agent is shown: enough to judge it, small enough for its context. */
const VIEW_WIDTH = 1024;

/** The image as it looks now, with the live edit applied, so an agent edits what it can see. */
const view = routedTool("read", async (request, space) =>
  withImage(space, itemId(request.input), async (image) => {
    const full = await renderLive(image, imageDocParts(image.doc));
    const scale = Math.min(1, VIEW_WIDTH / Math.max(full.width, full.height));
    const shown = document.createElement("canvas");
    shown.width = Math.max(1, Math.round(full.width * scale));
    shown.height = Math.max(1, Math.round(full.height * scale));
    shown.getContext("2d")?.drawImage(full, 0, 0, shown.width, shown.height);
    return {
      name: image.name,
      shown_at: { width: shown.width, height: shown.height },
      saves_at: { width: full.width, height: full.height },
      image: { dataUrl: shown.toDataURL("image/png") },
    };
  }),
);

export const imageTools: Record<string, LocalToolHandler> = {
  "image.view": view,
  "image.read": read,
  "image.edit": edit,
  "image.save": save,
  "image.cutout": cutout,
};
