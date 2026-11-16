import {
  canvasToBlob,
  defaultImageEdit,
  imageDocParts,
  loadPhoto,
  normalizeImageEdit,
  normalizeMark,
  outputSize,
  readImageEdit,
  renderFinal,
  writeImageEdit,
  type ImageEdit,
  type ImagePeerState,
  type Mark,
} from "@/features/files";
import { spacesGateway, type LiveLibraryImage } from "../../spaces-gateway/spacesGateway";
import { agentTag } from "../../tutor/agentTag";
import type { LocalToolHandler, LocalToolRequest } from "../host";
import { loadRunEntry } from "../runContexts";
import { BAD_SCHEMA, refuse } from "./api";
import { flag, text, textList } from "./args";
import { routedTool, type SpaceRow } from "./routing";

/**
 * An agent editing a Space Library image works in the same live edit as the people who have it
 * open: it joins the image's room, shows there as itself while it works, and its changes land in
 * front of everyone, who can undo them. Nothing reaches the image file until a save.
 */

/** How long to wait for the room's copy of the edit before giving up. */
const syncWaitMs = 8000;
/** How long the agent stays visible in the room after a change, so people see who made it. */
const lingerMs = 1200;

const UNAVAILABLE =
  "Live image editing isn't available here: the Space's server doesn't support it yet, or the image can't be reached.";
const VIEW_ONLY = "This image can only be viewed here, not edited.";

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
  request: LocalToolRequest,
  space: SpaceRow,
  work: (image: LiveLibraryImage) => Promise<T>,
): Promise<T> {
  const id = itemId(request.input);
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
  withImage(request, space, async (image) =>
    describe(image, readImageEdit(imageDocParts(image.doc))),
  ),
);

const adjustIds = [
  "exposure",
  "brightness",
  "contrast",
  "highlights",
  "shadows",
  "saturation",
  "vibrance",
  "warmth",
  "tint",
  "sharpness",
  "vignette",
] as const;

const finite = (value: unknown, low: number, high: number) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high)
    throw refuse(BAD_SCHEMA);
  return value;
};

const plainObject = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw refuse(BAD_SCHEMA);
  return value as Record<string, unknown>;
};

/** The edit after the model's changes, checked field by field. */
function applyChanges(
  current: ImageEdit,
  input: Record<string, unknown>,
  author: string,
): ImageEdit {
  let next: ImageEdit = flag(input, "reset") ? { ...defaultImageEdit } : { ...current };
  if (input.adjust !== undefined) {
    const adjust = plainObject(input.adjust);
    const values = { ...next.adjust };
    for (const [id, value] of Object.entries(adjust)) {
      if (!adjustIds.includes(id as (typeof adjustIds)[number])) throw refuse(BAD_SCHEMA);
      values[id as (typeof adjustIds)[number]] = Math.round(finite(value, -100, 100));
    }
    next.adjust = values;
  }
  const filter = text(input, "filter", {
    allowed: ["none", "vivid", "dramatic", "warm", "cool", "fade", "mono", "noir"],
  });
  if (filter) next.filter = filter as ImageEdit["filter"];
  if (input.filter_strength !== undefined)
    next.filterStrength = finite(input.filter_strength, 0, 100);
  const rotate = text(input, "rotate", { allowed: ["left", "right"] });
  if (rotate) {
    const { x, y, width, height } = next.crop;
    const clockwise = rotate === "right";
    next = {
      ...next,
      rotation: ((next.rotation + (clockwise ? 90 : 270)) % 360) as ImageEdit["rotation"],
      crop: clockwise
        ? { x: 1 - y - height, y: x, width: height, height: width }
        : { x: y, y: 1 - x - width, width: height, height: width },
      resize:
        next.resize && "width" in next.resize
          ? { width: next.resize.height, height: next.resize.width }
          : next.resize,
    };
  }
  const flip = text(input, "flip", { allowed: ["horizontal", "vertical"] });
  if (flip === "horizontal") {
    const { x, y, width, height } = next.crop;
    next = { ...next, flipX: !next.flipX, crop: { x: 1 - x - width, y, width, height } };
  } else if (flip === "vertical") {
    const { x, y, width, height } = next.crop;
    next = { ...next, flipY: !next.flipY, crop: { x, y: 1 - y - height, width, height } };
  }
  if (input.straighten !== undefined) next.straighten = finite(input.straighten, -45, 45);
  if (input.crop !== undefined) {
    const crop = plainObject(input.crop);
    next.crop = {
      x: finite(crop.x, 0, 1),
      y: finite(crop.y, 0, 1),
      width: finite(crop.width, 0.01, 1),
      height: finite(crop.height, 0.01, 1),
    };
  }
  const aspect = text(input, "aspect", {
    allowed: ["free", "original", "square", "4:3", "3:2", "16:9"],
  });
  if (aspect) next.aspect = aspect as ImageEdit["aspect"];
  if (input.resize !== undefined) {
    const resize = plainObject(input.resize);
    if (resize.scale !== undefined) next.resize = { scale: finite(resize.scale, 0.01, 16) };
    else if (resize.width !== undefined && resize.height !== undefined)
      next.resize = {
        width: Math.round(finite(resize.width, 1, 16_384)),
        height: Math.round(finite(resize.height, 1, 16_384)),
      };
    else next.resize = null;
  }
  const marks = { ...next.marks };
  if (flag(input, "clear_marks")) for (const id of Object.keys(marks)) delete marks[id];
  for (const id of textList(input, "remove_mark_ids", { max: 500, itemMin: 1, itemMax: 128 }) ?? [])
    delete marks[id];
  if (input.add_marks !== undefined) {
    if (!Array.isArray(input.add_marks) || input.add_marks.length > 200) throw refuse(BAD_SCHEMA);
    let z = Math.max(0, ...Object.values(marks).map((mark) => mark.z));
    for (const raw of input.add_marks) {
      const fields = plainObject(raw);
      const id = crypto.randomUUID();
      const mark = normalizeMark({
        color: "#ff3b30",
        ...fields,
        id,
        z: ++z,
        author,
      } as unknown as Mark);
      if (!mark) throw refuse(BAD_SCHEMA);
      marks[id] = mark;
    }
  }
  next.marks = marks;
  return normalizeImageEdit(next);
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

const edit = routedTool("change", async (request, space) => {
  const me = await agentPerson(request);
  return withImage(request, space, async (image) => {
    if (image.role === "viewer") throw refuse(VIEW_ONLY, "not_allowed");
    const parts = imageDocParts(image.doc);
    const before = readImageEdit(parts);
    const after = applyChanges(before, request.input, me.name);
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
});

const save = routedTool("change", async (request, space) => {
  const mode = text(request.input, "mode", { required: true, allowed: ["replace", "copy"] });
  const name = text(request.input, "name", { min: 1, max: 200 }).trim();
  return withImage(request, space, async (image) => {
    if (image.role === "viewer") throw refuse(VIEW_ONLY, "not_allowed");
    const parts = imageDocParts(image.doc);
    const current = readImageEdit(parts);
    const mimeType =
      image.mimeType === "image/jpeg" || image.mimeType === "image/webp"
        ? image.mimeType
        : "image/png";
    const extension =
      mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
    const original = await loadPhoto(await image.original());
    const blob = await canvasToBlob(renderFinal(original, current), mimeType);
    if (mode === "replace") {
      const version = await image.replace(blob);
      // The edit is in the image now: everyone starts again from the saved image.
      image.doc.transact(
        () => {
          parts.edit.clear();
          parts.adjust.clear();
          parts.marks.clear();
          parts.meta.set("base", String(version));
        },
        { image: "saved" },
      );
      return { saved: "replaced", name: image.name, version };
    }
    const stem = (name || `${image.name.replace(/\.[^./\\]+$/, "")} edited`).replace(
      /\.(png|jpe?g|webp)$/i,
      "",
    );
    const created = await image.saveCopy(blob, `${stem}.${extension}`);
    return { saved: "copy", name: `${stem}.${extension}`, item_id: created?.id ?? null };
  });
});

export const imageTools: Record<string, LocalToolHandler> = {
  "image.read": read,
  "image.edit": edit,
  "image.save": save,
};
