import type { LocalToolHandler, LocalToolRequest } from "../host";
import { runSpaceId } from "../runContexts";
import { NOT_ALLOWED, readRoute, refuse } from "./api";
import { text } from "./args";

/**
 * A run works in one Space: its agent's home Space, saved as the run started
 * (`runs/local-run/runSpace.ts`) and found by run id, so an outside engine's call through the local
 * MCP server lands in the same one. Every Space tool acts there without naming it. A tool that
 * names another Space is refused: that work belongs to an agent of that Space.
 */

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

/** The run's one Space, as a list for the tools that look through what they may reach. */
export async function listSpaces(
  request: Pick<LocalToolRequest, "signal" | "runId">,
): Promise<SpaceRow[]> {
  const [{ spaces }, home] = await Promise.all([
    readRoute<{ spaces: SpaceRow[] }>(request, "/spaces"),
    runSpaceId(request.runId),
  ]);
  // A run nobody noted has nothing to act in.
  if (home === null) throw refuse(NOT_ALLOWED, "not_allowed");
  // An agent with no home Space yet calls the person's own home.
  const space = home ? spaces.find((item) => item.id === home) : spaces.find(isPersonalSpace);
  if (!space) throw refuse(HOME_GONE, "home_space_gone");
  return [space];
}

/** The run's Space, or a refusal when `reference` names another one. */
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

/**
 * The Space a tool that isn't routed by `space` was asked to act in. It must be named, so nothing
 * is deleted or managed by default, and it must be the run's own.
 */
export async function namedSpace(request: LocalToolRequest): Promise<SpaceRow> {
  const reference = spaceArgument(request.input);
  if (!reference) throw refuse("pass space; call space_list for names and ids");
  const [space] = spaceTargets(await listSpaces(request), reference, "change");
  return space;
}

/** Wraps a tool that works in the run's one Space, refusing a `space` that names another. */
export function routedTool(kind: SpaceToolKind, run: SpaceToolRun): LocalToolHandler {
  return async (request) => {
    const reference = spaceArgument(request.input);
    const [space] = spaceTargets(await listSpaces(request), reference, kind);
    return run(request, space);
  };
}
