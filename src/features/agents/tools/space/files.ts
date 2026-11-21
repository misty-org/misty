import { agentFolderOf } from "../../artifacts/agentArtifacts";
import { spacesGateway, type SpaceDriveFile } from "../../spaces-gateway/spacesGateway";
import type { LocalToolHandler, LocalToolRequest } from "../host";
import { loadRunEntry } from "../runContexts";
import { refuse } from "./api";
import { integer, onlyFields, text } from "./args";
import { routedTool } from "./routing";

/**
 * The `file_*` tools work in the Space's drive: its Files, the same folders everyone in the Space and
 * its apps see, by path from its root (`/Design/Report.pdf`). What an agent makes goes into its own
 * folder there, `/Agents/<agent name>/`, unless it names another.
 */

const UNAVAILABLE = "The Space's Files can't be reached from here.";

/** The text files an agent can write, by extension. */
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
/** As large as a text file `file.read` hands back whole. */
const MAX_READ_TEXT_BYTES = 200_000;
/** How many entries a search reads at most, folder by folder from where it starts. */
const SEARCH_BUDGET = 2_000;

const messageOf = (cause: unknown) =>
  cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";

const gatewayOf = () => {
  const gateway = spacesGateway.maybe();
  if (!gateway) throw refuse(UNAVAILABLE, "unavailable");
  return gateway;
};

/** A drive call: what native refuses is said to the model, which can correct it. */
async function drive<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    throw refuse(messageOf(cause) || "Misty could not complete this tool call.");
  }
}

/** A drive path from the model's words: from the root, with no `..`. */
function drivePathOf(value: string, what = "path"): string {
  const parts = value.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === ".."))
    throw refuse(`${what} must be a path in the Space's Files, from its root, such as /Design`);
  return `/${parts.join("/")}`;
}

const facts = (entry: SpaceDriveFile) => ({
  id: entry.id,
  path: entry.path,
  name: entry.name,
  kind: entry.kind,
  size: entry.size,
  modified_at: new Date(entry.mtime_ms || 0).toISOString(),
  modified_by: entry.modified_by_name || undefined,
});

/** The folder a run's files go to: the one it names, or its agent's own. */
async function targetFolder(request: LocalToolRequest): Promise<string> {
  const named = text(request.input, "folder", { max: 1000 }).trim();
  if (named) return drivePathOf(named, "folder");
  const run = await loadRunEntry(request.runId).catch(() => null);
  return agentFolderOf(run?.agentId);
}

const search = routedTool("read", async (request, space) => {
  onlyFields(request.input, ["query", "folder", "limit", "space"]);
  const gateway = gatewayOf();
  const query = text(request.input, "query", { max: 200 }).trim().toLocaleLowerCase();
  const limit = integer(request.input, "limit");
  const count = limit === undefined || limit < 1 || limit > 50 ? 20 : limit;
  const start = drivePathOf(text(request.input, "folder", { max: 1000 }) || "/", "folder");
  const found: SpaceDriveFile[] = [];
  const folders = [start];
  let read = 0;
  // Without words it lists the folder; with them it looks through the folders under it too.
  while (folders.length && found.length < count && read < SEARCH_BUDGET) {
    const folder = folders.shift()!;
    let cursor: string | undefined;
    do {
      const page = await drive(() => gateway.driveList(space.id, folder, { cursor, limit: 200 }));
      for (const entry of page.entries) {
        read += 1;
        if (entry.name.startsWith(".")) continue;
        if (!query || entry.name.toLocaleLowerCase().includes(query)) found.push(entry);
        if (query && entry.kind === "folder") folders.push(entry.path);
      }
      cursor = page.next_cursor ?? undefined;
    } while (cursor && found.length < count && read < SEARCH_BUDGET);
    if (!query) break;
  }
  const files = found.slice(0, count).map(facts);
  return { files, count: files.length };
});

const read = routedTool("read", async (request, space) => {
  onlyFields(request.input, ["path", "space"]);
  const path = drivePathOf(text(request.input, "path", { required: true, min: 1, max: 1000 }));
  const gateway = gatewayOf();
  const entry = await drive(() => gateway.driveEntry(space.id, path));
  if (!entry) throw refuse(`nothing is at ${path} in the Space's Files`);
  const extension = /\.([a-z]+)$/i.exec(entry.name)?.[1]?.toLowerCase() ?? "";
  if (entry.kind !== "file" || !textTypes[extension] || entry.size > MAX_READ_TEXT_BYTES)
    return facts(entry);
  const bytes = await drive(() => gateway.driveRead(space.id, entry.path));
  return { ...facts(entry), text: new TextDecoder().decode(bytes) };
});

/** A text file's name and bytes from the call, checked. */
function textFile(input: Record<string, unknown>) {
  const name = text(input, "name", { required: true, min: 1, max: 200 }).trim();
  const content = text(input, "content", { required: true, min: 1, max: MAX_TEXT_FILE_BYTES });
  const extension = /\.([a-z]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  if (!textTypes[extension] || name.length === extension.length + 1 || /[\\/]/.test(name))
    throw refuse(
      "name the file with one of .html, .md, .txt, .json, .csv or .svg at the end, and no folders",
    );
  const bytes = new TextEncoder().encode(content);
  if (bytes.byteLength > MAX_TEXT_FILE_BYTES)
    throw refuse("the file is over 1.5 MB; make it smaller and save it again");
  return { name, bytes, type: textTypes[extension] };
}

/** Writes a new text file into the Space's drive, in the agent's folder unless it names another. */
const create = routedTool("create", async (request, space) => {
  onlyFields(request.input, ["name", "content", "folder", "space"]);
  const file = textFile(request.input);
  const gateway = gatewayOf();
  const folder = await targetFolder(request);
  const saved = await drive(() =>
    gateway.saveToDrive(space.id, folder, file.name, new Blob([file.bytes], { type: file.type })),
  );
  return { ...facts(saved), space: space.name };
});

/** Writes new content into a text file already in the drive, made from the version it has now. */
const update = routedTool("change", async (request, space) => {
  onlyFields(request.input, ["path", "content", "space"]);
  const path = drivePathOf(text(request.input, "path", { required: true, min: 1, max: 1000 }));
  const name = path.split("/").pop() ?? "";
  const file = textFile({ name, content: request.input.content });
  const gateway = gatewayOf();
  const entry = await drive(() => gateway.driveEntry(space.id, path));
  if (!entry || entry.kind !== "file") throw refuse(`no file at ${path} in the Space's Files`);
  const saved = await drive(() =>
    gateway.driveReplace(space.id, entry, new Blob([file.bytes], { type: file.type })),
  );
  return { ...facts(saved), space: space.name };
});

/** Saves a chat attachment into the Space's drive under the name given. */
const promote = routedTool("change", async (request, space) => {
  onlyFields(request.input, ["attachmentId", "name", "folder", "space"]);
  const id = text(request.input, "attachmentId", { max: 200 }).trim();
  if (!id) throw refuse("attachment id is required");
  const name = text(request.input, "name", { required: true, min: 1, max: 200 }).trim();
  if (!name || /[\\/]/.test(name)) throw refuse("name the file, with its extension and no folders");
  const gateway = gatewayOf();
  const folder = await targetFolder(request);
  const content = await drive(() => gateway.attachmentContent(space.id, id));
  const saved = await drive(() => gateway.saveToDrive(space.id, folder, name, content));
  return { ...facts(saved), space: space.name };
});

export const fileTools: Record<string, LocalToolHandler> = {
  "file.search": search,
  "file.read": read,
  "file.create": create,
  "file.update": update,
  "file.promote_attachment": promote,
};
