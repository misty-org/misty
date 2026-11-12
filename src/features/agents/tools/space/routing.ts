import type { LocalToolHandler, LocalToolRequest } from "../host";
import { runSpaceId } from "../runContexts";
import { NOT_ALLOWED, SpaceCallRefused, readRoute, refuse } from "./api";
import { text, truncate } from "./args";

/**
 * Space tools name a Space by name or id with an optional `space`. A chat's run works in that chat's
 * one Space: every tool acts there, and another Space is refused. A run in no Space reads every
 * Space the person can access without one, creates in their personal Space, and changes existing
 * items in the Space returned with them.
 */
const MAX_READ_SPACES = 25;

export interface SpaceRow {
  id: string;
  name: string;
  is_default: boolean;
  is_shared: boolean;
  role: string;
}

export type SpaceToolKind = "read" | "create" | "change";

export type SpaceToolRun = (request: LocalToolRequest, space: SpaceRow) => Promise<unknown>;

/** The Spaces this run may reach: its chat's one Space, or every Space for a run in none. */
export async function listSpaces(
  request: Pick<LocalToolRequest, "signal" | "runId">,
): Promise<SpaceRow[]> {
  const [{ spaces }, own] = await Promise.all([
    readRoute<{ spaces: SpaceRow[] }>(request, "/spaces"),
    runSpaceId(request.runId),
  ]);
  if (!own) return spaces;
  const space = spaces.find((item) => item.id === own);
  if (!space) throw refuse("this chat's Space is no longer yours; move the chat to another Space");
  return [space];
}

export const isPersonalSpace = (space: SpaceRow) => space.is_default && space.role === "owner";

const quoted = (value: string) => JSON.stringify(value);

function spaceChoices(spaces: SpaceRow[]): string {
  return spaces
    .slice(0, 20)
    .map((space) => `${quoted(space.name)} (${space.id})`)
    .join(", ");
}

export function spaceTargets(
  spaces: SpaceRow[],
  reference: string,
  kind: SpaceToolKind,
): SpaceRow[] {
  if (reference) {
    const byId = spaces.find((space) => space.id === reference);
    if (byId) return [byId];
    const wanted = reference.toLowerCase();
    const named = spaces.filter((space) => space.name.trim().toLowerCase() === wanted);
    if (named.length === 1) return named;
    if (named.length === 0) {
      throw refuse(
        spaces.length === 1
          ? `this chat works only in ${quoted(spaces[0].name)} (${spaces[0].id})`
          : `unknown space ${quoted(reference)}; available: ${spaceChoices(spaces)}`,
      );
    }
    throw refuse(
      `several Spaces are named ${quoted(reference)}; pass one id: ${spaceChoices(named)}`,
    );
  }
  if (spaces.length === 0) throw refuse("this account has no Spaces yet");
  // One Space reachable, as in a chat's run: everything happens there.
  if (spaces.length === 1) return spaces;
  if (kind === "read") return spaces.slice(0, MAX_READ_SPACES);
  if (kind === "create") {
    const personal = spaces.find(isPersonalSpace);
    if (personal) return [personal];
  }
  throw refuse(`pass space for this change; available: ${spaceChoices(spaces)}`);
}

export const spaceArgument = (input: Record<string, unknown>) =>
  text(input, "space", { min: 1, max: 200 }).trim();

/** The one Space a tool that isn't routed by `space` was asked to act in. */
export async function namedSpace(request: LocalToolRequest): Promise<SpaceRow> {
  const reference = spaceArgument(request.input);
  if (!reference) throw refuse("pass space; call space_list for names and ids");
  const [space] = spaceTargets(await listSpaces(request), reference, "change");
  return space;
}

/** A Space's answer that it doesn't grant this read. That isn't a failure, just nothing there. */
const isDenied = (error: unknown) =>
  error instanceof SpaceCallRefused && (error.status === 403 || error.status === 404);

interface SpaceAnswer {
  space_id: string;
  space_name: string;
  result?: unknown;
  error?: string;
}

async function readEverySpace(
  request: LocalToolRequest,
  spaces: SpaceRow[],
  run: SpaceToolRun,
): Promise<{ spaces: SpaceAnswer[] }> {
  const answers: SpaceAnswer[] = [];
  let succeeded = 0;
  let firstError: unknown;
  for (const space of spaces) {
    request.signal.throwIfAborted();
    const row = { space_id: space.id, space_name: space.name };
    try {
      answers.push({ ...row, result: await run(request, space) });
      succeeded += 1;
    } catch (error) {
      if (isDenied(error)) continue;
      firstError ??= error;
      const message = error instanceof Error ? error.message : String(error);
      answers.push({ ...row, error: truncate(message, 300) });
    }
  }
  if (succeeded === 0) throw firstError ?? refuse(NOT_ALLOWED, "not_allowed");
  return { spaces: answers };
}

/** Wraps a tool that works in one Space with the account-wide `space` argument. */
export function routedTool(kind: SpaceToolKind, run: SpaceToolRun): LocalToolHandler {
  return async (request) => {
    const reference = spaceArgument(request.input);
    const targets = spaceTargets(await listSpaces(request), reference, kind);
    if (targets.length === 1) return run(request, targets[0]);
    return readEverySpace(request, targets, run);
  };
}
