/**
 * The shapes a live session shares through its Yjs doc (the contract's layout) and what this
 * window keeps about the session it joined.
 */

/** Who made a change: a person, or an agent working for one. */
export interface StepAuthor {
  kind: "person" | "agent";
  id: string;
  name: string;
  /** An agent's person; a person's own id and name. */
  ownerId: string;
  ownerName: string;
}

/** A Y.RelativePosition as JSON, which every member resolves against their own copy. */
export type RelativeJson = Record<string, unknown>;

/** One step of the history: a stretch of one author's work on one file. */
export interface LiveStep {
  id: string;
  author: StepAuthor;
  /** Relative to the repository, with `/` between names. */
  path: string;
  /** When the step closed, in ms. */
  at: number;
  /** One line, built in code: "Edited sort.ts, +12 −3". */
  summary: string;
  inserted: Array<{ start: RelativeJson; end: RelativeJson }>;
  deleted: Array<{ at: RelativeJson; text: string }>;
}

/**
 * Everyone who wrote in the session, in `doc.getMap("people")` by author key: their name, and for
 * a person the Git identity their commit is made with, which they share by joining.
 */
export interface LivePerson extends StepAuthor {
  gitName?: string;
  gitEmail?: string;
}

/** Main, as the author of conflicts it brought into the session when a merge didn't go cleanly. */
export const mainAuthor: StepAuthor = {
  kind: "person",
  id: "main",
  name: "main",
  ownerId: "main",
  ownerName: "main",
};

/** The one key an author goes by in the doc's user data and the history's lanes. */
export function authorKey(author: Pick<StepAuthor, "kind" | "id" | "ownerId">): string {
  if (author.id === mainAuthor.id) return "main";
  return author.kind === "agent" ? `agent:${author.ownerId}:${author.id}` : `person:${author.id}`;
}

/** The person an author's work belongs to: themselves, or an agent's owner. */
export const ownerKey = (author: Pick<StepAuthor, "ownerId">) =>
  author.ownerId === mainAuthor.id ? "main" : `person:${author.ownerId}`;

/** What awareness carries for each window in the session. */
export interface LiveAwareness {
  user?: { id: string; name: string; color: string; colorLight: string };
  path?: string | null;
}

/** The session this window joined for a Space folder, kept so a reload joins it again. */
export interface LiveJoin {
  spaceId: string;
  /** The key the Space's linked folders are kept under. */
  spaceKey: string;
  /** The person's own checkout, the Space folder the session was joined from. */
  spaceFolder: string;
  /** This person's worktree of the session branch. */
  folder: string;
  sessionId: string;
  name: string;
  branch: string;
  baseCommit: string;
  repoKey: string;
  startedById: string;
  startedByName: string;
}

/** Outside edits from the native watcher. */
export interface FileChangedEvent {
  folder: string;
  path: string;
  text: string | null;
}

/** The repository as the native side reads it (`code_live_repo`). */
export interface LiveRepo {
  repoKey: string;
  root: string;
  head: string;
  branch: string | null;
  defaultBranch: string | null;
  baseOnRemote: boolean;
  mainAhead: number | null;
  fetchError: string | null;
  gitName: string | null;
  gitEmail: string | null;
}

/** The ways a session ends, as the server records them. */
export type LiveOutcome = "merged" | "pr" | "kept" | "discarded";
