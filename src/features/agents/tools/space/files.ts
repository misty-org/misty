import type { LocalToolHandler } from "../host";
import { readRoute, refuse, segment, spacePath, writeRoute } from "./api";
import { flag, integer, onlyFields, text, textList } from "./args";
import { routedTool } from "./routing";

interface LibraryItem {
  id: string;
  version: number;
  display_name: string;
  caption: string;
  tags: string[];
  favorite: boolean;
  hidden: boolean;
}

const itemPath = (spaceId: string, id: string) =>
  spacePath(spaceId, `/library/items/${segment(id)}`);

const itemId = (input: Record<string, unknown>) => {
  const id = text(input, "id", { max: 200 }).trim();
  if (!id) throw refuse("Library item id is required");
  return id;
};

const search = routedTool("read", async (request, space) => {
  const query = text(request.input, "query").trim();
  const limit = integer(request.input, "limit");
  const count = limit === undefined || limit < 1 || limit > 50 ? 20 : limit;
  const words = query ? `&q=${segment(query)}` : "";
  const { items } = await readRoute<{ items: LibraryItem[] }>(
    request,
    spacePath(space.id, `/library?limit=${count}&visibility=visible${words}`),
  );
  return { items, count: items.length };
});

const read = routedTool("read", async (request, space) => {
  onlyFields(request.input, ["id", "space"]);
  return readRoute(request, itemPath(space.id, itemId(request.input)));
});

const update = routedTool("change", async (request, space) => {
  const { input } = request;
  onlyFields(input, ["id", "displayName", "caption", "tags", "favorite", "hidden", "space"]);
  const id = itemId(input);
  const displayName =
    input.displayName === undefined ? undefined : text(input, "displayName", { max: 255 });
  const caption = input.caption === undefined ? undefined : text(input, "caption", { max: 4000 });
  const tags = textList(input, "tags", { max: 100 });
  const favorite = flag(input, "favorite");
  const hidden = flag(input, "hidden");
  const path = itemPath(space.id, id);
  const current = await readRoute<LibraryItem>(request, path);
  return writeRoute(request, path, "PATCH", {
    version: current.version,
    display_name: displayName ?? current.display_name,
    caption: caption ?? current.caption,
    tags: tags ?? current.tags,
    favorite: favorite ?? current.favorite,
    hidden: hidden ?? current.hidden,
  });
});

const promote = routedTool("change", async (request, space) => {
  onlyFields(request.input, ["attachmentId", "space"]);
  const id = text(request.input, "attachmentId", { max: 200 }).trim();
  if (!id) throw refuse("attachment id is required");
  return writeRoute(request, spacePath(space.id, `/attachments/${segment(id)}/promote`), "POST");
});

export const fileTools: Record<string, LocalToolHandler> = {
  "file.search": search,
  "file.read": read,
  "file.update": update,
  "file.promote_attachment": promote,
};

export const fileWriteTools = ["file.update", "file.promote_attachment"];
