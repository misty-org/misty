import { ApiRequestError } from "@/api/client";
import { spacesGateway, type AgentArtifactProvenance } from "../../spaces-gateway/spacesGateway";
import type { LocalToolHandler } from "../host";
import { loadRunEntry } from "../runContexts";
import { readRoute, refuse, segment, spacePath, writeRoute, writeSteps } from "./api";
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

/** The text files an agent can write into the Library, by extension, as the Library keeps them. */
const textTypes: Record<string, string> = {
  html: "text/html",
  md: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  csv: "text/csv",
  svg: "image/svg+xml",
};

/** As large as a file written in one call may be. */
const MAX_TEXT_FILE_BYTES = 1_500_000;

/** The tag that puts a Library page in the studio's arcade cabinet. */
const GAME_TAG = "game";

/**
 * Writes a new text file into the run's Space Library, through the person's own upload, the
 * same as a file they add by hand. In the agent's home Space it is credited to the agent; a file
 * marked as a game is tagged so the studio's arcade lists it.
 */
const create = routedTool("create", async (request, space) => {
  const { input } = request;
  onlyFields(input, ["name", "content", "caption", "tags", "game", "space"]);
  const name = text(input, "name", { required: true, min: 1, max: 200 }).trim();
  const content = text(input, "content", { required: true, min: 1, max: MAX_TEXT_FILE_BYTES });
  const caption = text(input, "caption", { max: 4000 });
  const tags = textList(input, "tags", { max: 30, itemMin: 1, itemMax: 60 }) ?? [];
  const game = flag(input, "game") ?? false;
  const extension = /\.([a-z]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  const type = textTypes[extension];
  if (!type || name.length === extension.length + 1 || /[\\/]/.test(name))
    throw refuse(
      "name the file with one of .html, .md, .txt, .json, .csv or .svg at the end, and no folders",
    );
  if (game && extension !== "html")
    throw refuse("a game is one .html page: name it with .html at the end");
  const bytes = new TextEncoder().encode(content);
  if (bytes.byteLength > MAX_TEXT_FILE_BYTES)
    throw refuse("the file is over 1.5 MB; make it smaller and save it again");
  const gateway = spacesGateway.maybe();
  if (!gateway) throw refuse("Saving files isn't available on this computer yet.", "unavailable");
  const saved =
    game && !tags.some((tag) => tag.toLowerCase() === GAME_TAG) ? [...tags, GAME_TAG] : tags;
  const run = await loadRunEntry(request.runId).catch(() => null);
  // Only the agent's own home Space lists it, so a file saved anywhere else is the person's.
  const agent: AgentArtifactProvenance | undefined =
    run?.agentId && run.spaceId === space.id
      ? {
          agent_id: run.agentId,
          conversation_id: run.conversationId || undefined,
          run_id: request.runId,
          kind: "file",
        }
      : undefined;
  const blob = new Blob([bytes], { type });
  const upload = (credit?: AgentArtifactProvenance) =>
    gateway.uploadLibraryBlob(space.id, blob, name, "library", {
      signal: request.signal,
      ...(credit ? { agent: credit } : {}),
    });
  const uploaded = await writeSteps(async () => {
    if (!agent) return upload();
    try {
      return await upload(agent);
    } catch (error) {
      // A Space that doesn't list the agent refuses the credit before anything is stored, so
      // the file is saved under the person's name alone.
      if (error instanceof ApiRequestError && error.status === 403) return upload();
      throw error;
    }
  });
  const id = uploaded.item?.id ?? null;
  const result = { id, name, space: space.name, tags: saved, game };
  if (!id || (!saved.length && !caption)) return result;
  try {
    const path = itemPath(space.id, id);
    const current = await readRoute<LibraryItem>(request, path);
    await writeRoute(request, path, "PATCH", {
      version: current.version,
      display_name: current.display_name,
      caption: caption || current.caption,
      tags: [...new Set([...current.tags, ...saved])],
      favorite: current.favorite,
      hidden: current.hidden,
    });
    return result;
  } catch {
    // The file is in the Library already: saying it failed would only get it saved twice.
    return {
      ...result,
      tags: [],
      note: "The file was saved, but its caption and tags were not. Set them with file_update.",
    };
  }
});

export const fileTools: Record<string, LocalToolHandler> = {
  "file.search": search,
  "file.read": read,
  "file.create": create,
  "file.update": update,
  "file.promote_attachment": promote,
};
