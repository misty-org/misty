import type { LocalToolHandler, LocalToolRequest } from "../host";
import { readRoute, refuse, rewordRefusal, segment, spacePath, writeRoute } from "./api";
import { onlyFields, text } from "./args";
import { namedSpace, type SpaceRow } from "./routing";

const DELETE_KINDS = ["thread", "shared_file"] as const;
const RENAME_KINDS = ["thread"] as const;

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
