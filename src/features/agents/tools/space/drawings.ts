import type { LocalToolHandler } from "../host";
import { BAD_SCHEMA, readRoute, refuse, segment, spacePath, writeRoute } from "./api";
import { flag, integer, text, textList } from "./args";
import { routedTool } from "./routing";

interface Drawing {
  title: string;
}

const ELEMENT_TYPES = [
  "rectangle",
  "diamond",
  "ellipse",
  "text",
  "line",
  "arrow",
  "freedraw",
  "image",
  "frame",
  "magicframe",
  "iframe",
  "embeddable",
] as const;

const scenePath = (spaceId: string, drawingId: string) =>
  spacePath(spaceId, `/drawings/${segment(drawingId)}/scene`);

const drawingId = (input: Record<string, unknown>) => {
  const id = text(input, "drawing_id", { max: 200 }).trim();
  if (!id) throw refuse("drawing_id is required");
  return id;
};

const list = routedTool("read", async (request, space) => {
  const query = text(request.input, "query", { max: 500 }).trim().toLowerCase();
  const limit = integer(request.input, "limit", 1, 100) ?? 50;
  const { drawings } = await readRoute<{ drawings: Drawing[] }>(
    request,
    spacePath(space.id, "/drawings"),
  );
  const matches = drawings
    .filter((drawing) => !query || drawing.title.toLowerCase().includes(query))
    .slice(0, limit);
  return { drawings: matches, count: matches.length };
});

const create = routedTool("create", async (request, space) =>
  writeRoute(request, spacePath(space.id, "/drawings"), "POST", {
    title: text(request.input, "title", { max: 200 }),
  }),
);

const read = routedTool("read", async (request, space) => {
  const id = drawingId(request.input);
  const deleted = flag(request.input, "include_deleted") === true;
  return readRoute(request, `${scenePath(space.id, id)}?include_deleted=${deleted}`);
});

function checkElements(elements: unknown) {
  if (elements === undefined || elements === null) return;
  if (!Array.isArray(elements) || elements.length > 500) throw refuse(BAD_SCHEMA);
  for (const element of elements) {
    if (!element || typeof element !== "object" || Array.isArray(element)) {
      throw refuse(BAD_SCHEMA);
    }
    const fields = element as Record<string, unknown>;
    text(fields, "id", { required: true, min: 1, max: 128 });
    text(fields, "type", { allowed: ELEMENT_TYPES });
    text(fields, "text", { max: 100_000 });
  }
}

const apply = routedTool("change", async (request, space) => {
  const id = drawingId(request.input);
  // The room checks the elements' own fields.
  const { base_hash, mode, elements, delete_element_ids, scene } = request.input;
  text(request.input, "base_hash", { min: 64, max: 64 });
  text(request.input, "mode", { allowed: ["merge", "replace"] });
  checkElements(elements);
  textList(request.input, "delete_element_ids", { max: 500, itemMin: 1, itemMax: 128 });
  if (scene !== undefined && (typeof scene !== "object" || Array.isArray(scene))) {
    throw refuse(BAD_SCHEMA);
  }
  const change = { base_hash, mode, elements, delete_element_ids, scene };
  // A retried change with this key answers from the room's record rather than applying twice.
  return writeRoute(request, scenePath(space.id, id), "POST", change, {
    "Idempotency-Key": request.callId,
  });
});

export const drawingTools: Record<string, LocalToolHandler> = {
  "drawing.list": list,
  "drawing.create": create,
  "drawing.read": read,
  "drawing.apply": apply,
};
