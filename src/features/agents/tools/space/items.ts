import type { LocalToolHandler, LocalToolRequest } from "../host";
import {
  SpaceCallRefused,
  readRoute,
  refuse,
  rewordRefusal,
  segment,
  spacePath,
  writeRoute,
} from "./api";
import { onlyFields, text } from "./args";
import { listSpaces, namedSpace, spaceArgument, type SpaceRow } from "./routing";

const DELETE_KINDS = ["note", "drawing", "thread", "library_item", "shared_file"] as const;
const RENAME_KINDS = ["drawing", "thread"] as const;

interface Found<T> {
  space: SpaceRow;
  item: T;
}

/**
 * Notes and drawings are found by id alone, whichever Space they're in. Routes are under a Space, so
 * this looks through them, the named one first.
 */
async function findInSpaces<T>(
  request: LocalToolRequest,
  path: (space: SpaceRow) => string,
): Promise<Found<T> | undefined> {
  const reference = spaceArgument(request.input);
  const spaces = await listSpaces(request);
  const named = (space: SpaceRow) => space.id === reference || space.name === reference;
  const ordered = [...spaces.filter(named), ...spaces.filter((space) => !named(space))];
  for (const space of ordered) {
    try {
      return { space, item: await readRoute<T>(request, path(space)) };
    } catch (error) {
      const elsewhere =
        error instanceof SpaceCallRefused && (error.status === 403 || error.status === 404);
      if (!elsewhere) throw error;
    }
  }
  return undefined;
}

const notePath = (space: SpaceRow, id: string) => spacePath(space.id, `/notes/${segment(id)}`);
const drawingPath = (space: SpaceRow, id: string) =>
  spacePath(space.id, `/drawings/${segment(id)}`);
const threadPath = (space: SpaceRow, id: string) =>
  spacePath(space.id, `/conversations/${segment(id)}`);

async function threadTitle(request: LocalToolRequest, space: SpaceRow, id: string) {
  const { conversations } = await readRoute<{ conversations: { id: string; title: string }[] }>(
    request,
    spacePath(space.id, "/conversations"),
  );
  return conversations.find((thread) => thread.id === id)?.title;
}

interface Doomed {
  spaceId: string;
  title: string;
  remove: () => Promise<unknown>;
}

async function findDoomed(
  request: LocalToolRequest,
  kind: string,
  id: string,
): Promise<Doomed | undefined> {
  if (kind === "note" || kind === "drawing") {
    const isNote = kind === "note";
    const path = (space: SpaceRow) => (isNote ? notePath : drawingPath)(space, id);
    const found = await findInSpaces<{ title: string }>(request, path);
    if (!found) return undefined;
    return {
      spaceId: found.space.id,
      title: found.item.title,
      remove: () => writeRoute(request, path(found.space), "DELETE"),
    };
  }
  const space = await namedSpace(request);
  if (kind === "thread") {
    const title = await threadTitle(request, space, id);
    if (title === undefined) return undefined;
    return {
      spaceId: space.id,
      title,
      remove: () => writeRoute(request, threadPath(space, id), "DELETE"),
    };
  }
  if (kind === "shared_file") {
    const { nodes } = await readRoute<{ nodes: { id: string; display_name: string }[] }>(
      request,
      spacePath(space.id, "/nodes"),
    );
    const node = nodes.find((candidate) => candidate.id === id);
    if (!node) return undefined;
    return {
      spaceId: space.id,
      title: node.display_name,
      remove: () => writeRoute(request, spacePath(space.id, `/nodes/${segment(id)}`), "DELETE"),
    };
  }
  const path = spacePath(space.id, `/library/items/${segment(id)}`);
  const item = await readRoute<{ display_name: string }>(request, path);
  return {
    spaceId: space.id,
    title: item.display_name,
    remove: () => writeRoute(request, `${path}/trash`, "POST"),
  };
}

const deleteItem: LocalToolHandler = async (request) => {
  onlyFields(request.input, ["kind", "id", "space"]);
  const kind = text(request.input, "kind", { required: true, allowed: DELETE_KINDS });
  const id = text(request.input, "id", { required: true, min: 1, max: 200 }).trim();
  const missing = `no ${kind} ${id} that you can delete`;
  const doomed = await rewordRefusal(
    () => findDoomed(request, kind, id),
    (refused) => (refused.status === 403 || refused.status === 404 ? missing : undefined),
  );
  if (!doomed) throw refuse(missing);
  await rewordRefusal(doomed.remove, (refused) =>
    refused.status === 403 ? `you do not have permission to delete that ${kind}` : undefined,
  );
  return {
    deleted: kind,
    id,
    title: doomed.title.trim() ? doomed.title : `Untitled ${kind}`,
    space_id: doomed.spaceId,
  };
};

const renameItem: LocalToolHandler = async (request) => {
  onlyFields(request.input, ["kind", "id", "name", "space"]);
  const kind = text(request.input, "kind", { required: true, allowed: RENAME_KINDS });
  const id = text(request.input, "id", { required: true, min: 1, max: 200 }).trim();
  const name = text(request.input, "name", { required: true, min: 1, max: 200 }).trim();
  const missing = `no ${kind} ${id} that you can rename`;
  const anyRefusal = () => missing;
  if (kind === "drawing") {
    const found = await rewordRefusal(
      () => findInSpaces(request, (space) => drawingPath(space, id)),
      anyRefusal,
    );
    if (!found) throw refuse(missing);
    const drawing = await rewordRefusal(
      () =>
        writeRoute<{ id: string; title: string }>(request, drawingPath(found.space, id), "PATCH", {
          title: name,
        }),
      anyRefusal,
    );
    return { renamed: "drawing", id: drawing.id, name: drawing.title };
  }
  const space = await namedSpace(request);
  const title = await rewordRefusal(() => threadTitle(request, space, id), anyRefusal);
  if (title === undefined) throw refuse(missing);
  const thread = await rewordRefusal(
    () =>
      writeRoute<{ id: string; title: string }>(request, threadPath(space, id), "PATCH", {
        title: name,
      }),
    anyRefusal,
  );
  return { renamed: "thread", id: thread.id, name: thread.title };
};

export const itemTools: Record<string, LocalToolHandler> = {
  "item.delete": deleteItem,
  "item.rename": renameItem,
};
