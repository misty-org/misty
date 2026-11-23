import type { LocalToolHandler, LocalToolRequest } from "../host";
import { runSpaceId } from "../run_contexts";
import { NOT_ALLOWED, readRoute, refuse } from "./api";
import { text } from "./args";

export interface SpaceRow {
  id: string;
  name: string;
  is_default: boolean;
  is_shared: boolean;
  role: string;
}

type SpaceToolKind = "read" | "create" | "change";

type SpaceToolRun = (request: LocalToolRequest, space: SpaceRow) => Promise<unknown>;

export const isPersonalSpace = (space: SpaceRow) => space.is_default && space.role === "owner";

const HOME_GONE =
  "My home Space is gone: it was deleted, or the person left it. Ask them to pick a new home Space in my settings.";

export async function listSpaces(
  request: Pick<LocalToolRequest, "signal" | "runId">,
): Promise<SpaceRow[]> {
  const [{ spaces }, home] = await Promise.all([
    readRoute<{ spaces: SpaceRow[] }>(request, "/spaces"),
    runSpaceId(request.runId),
  ]);
  if (home === null) throw refuse(NOT_ALLOWED, "not_allowed");
  const space = home ? spaces.find((item) => item.id === home) : spaces.find(isPersonalSpace);
  if (!space) throw refuse(HOME_GONE, "home_space_gone");
  return [space];
}

export function spaceTargets(
  spaces: SpaceRow[],
  reference: string,
  _kind: SpaceToolKind = "read",
): SpaceRow[] {
  const [home] = spaces;
  if (!home) throw refuse(HOME_GONE, "home_space_gone");
  if (!reference) return [home];
  const wanted = reference.trim().toLowerCase();
  if (home.id === reference || home.name.trim().toLowerCase() === wanted) return [home];
  throw refuse(`I can only work in ${home.name}. Ask an agent in that Space.`, "other_space");
}

export const spaceArgument = (input: Record<string, unknown>) =>
  text(input, "space", { min: 1, max: 200 }).trim();

export async function namedSpace(request: LocalToolRequest): Promise<SpaceRow> {
  const reference = spaceArgument(request.input);
  if (!reference) throw refuse("pass space; call space_list for names and ids");
  const [space] = spaceTargets(await listSpaces(request), reference, "change");
  return space;
}

export function routedTool(kind: SpaceToolKind, run: SpaceToolRun): LocalToolHandler {
  return async (request) => {
    const reference = spaceArgument(request.input);
    const [space] = spaceTargets(await listSpaces(request), reference, kind);
    return run(request, space);
  };
}
