import type { LocalToolHandler } from "../host";
import { readRoute, refuse, rewordRefusal, segment, spacePath, writeRoute } from "./api";
import { integer, onlyFields, text, textList } from "./args";
import { routedTool } from "./routing";

interface Note {
  id: string;
  space_id: string;
  title: string;
  markdown?: string;
  created_at: string;
  updated_at: string;
  role: string;
}

const notesPath = (spaceId: string, rest = "") => spacePath(spaceId, `/notes${rest}`);

const search = routedTool("read", async (request, space) => {
  const query = text(request.input, "query", { max: 500 }).trim();
  const limit = integer(request.input, "limit", 1, 50) ?? 20;
  const path = query
    ? `${notesPath(space.id)}?q=${segment(query)}&limit=${limit}`
    : notesPath(space.id);
  const { notes } = await readRoute<{ notes: Note[] }>(request, path);
  const matches = notes.slice(0, limit);
  return { notes: matches, count: matches.length };
});

const read = routedTool("read", async (request, space) => {
  const id = text(request.input, "id", { max: 200 }).trim();
  if (!id) throw refuse("note id is required");
  const note = await readRoute<Note>(request, notesPath(space.id, `/${segment(id)}`));
  const markdown = note.markdown ?? "";
  // The body is always present, so an empty Note reads as empty rather than as content left out.
  return {
    id: note.id,
    space_id: note.space_id,
    title: note.title,
    markdown,
    empty: markdown.trim() === "",
    created_at: note.created_at,
    updated_at: note.updated_at,
    role: note.role,
  };
});

const create = routedTool("create", async (request, space) => {
  const title = text(request.input, "title", { max: 500 });
  const markdown = text(request.input, "markdown", { max: 100_000 });
  if (!title.trim() || !markdown.trim()) throw refuse("note title and markdown are required");
  return writeRoute(request, notesPath(space.id), "POST", { title, markdown });
});

const update = routedTool("change", async (request, space) => {
  const id = text(request.input, "id", { max: 200 }).trim();
  const title = text(request.input, "title", { max: 500 });
  const markdown = text(request.input, "markdown", { max: 100_000 });
  const append = text(request.input, "append", { max: 100_000 });
  if (!id) throw refuse("note id is required");
  if (markdown && append) {
    throw refuse("use markdown to replace the body or append to add to it, not both");
  }
  return writeRoute(request, notesPath(space.id, `/${segment(id)}/content`), "PUT", {
    title,
    markdown,
    append,
  });
});

const tag = routedTool("change", async (request, space) => {
  onlyFields(request.input, ["id", "tags", "space"]);
  const id = text(request.input, "id", { required: true, min: 1, max: 200 });
  const tags = textList(request.input, "tags", {
    required: true,
    max: 30,
    itemMin: 1,
    itemMax: 60,
  }) as string[];
  const path = notesPath(space.id, `/${segment(id.trim())}`);
  const note = await rewordRefusal(
    () => readRoute<Note>(request, path),
    () => `no note ${id} in this Space; call note_search`,
  );
  await rewordRefusal(
    () => writeRoute(request, `${path}/metadata`, "PATCH", { shared_tags: tags }),
    () => "those tags could not be saved; you may not be able to edit this note",
  );
  return { note_id: note.id, tags };
});

export const noteTools: Record<string, LocalToolHandler> = {
  "note.search": search,
  "note.read": read,
  "note.create": create,
  "note.update": update,
  "note.tag": tag,
};

export const noteWriteTools = ["note.create", "note.update", "note.tag"];
