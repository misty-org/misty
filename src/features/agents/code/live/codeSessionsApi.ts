import { spacesGateway } from "../../spaces-gateway/spacesGateway";

/** The Space server's API, through the port Spaces fills in at startup. */
const spaceRequest = <T>(path: string, init?: RequestInit) =>
  spacesGateway.get().spaceRequest<T>(path, init);

/** How a live session ended: merged into the base branch, opened as a pull request, kept as a branch, or thrown away. */
export type CodeSessionOutcome = "merged" | "pr" | "kept" | "discarded";

/** A live code session in a Space: Space members edit one branch of a repo together. */
export interface CodeSession {
  id: string;
  spaceId: string;
  name: string;
  /** The normalized origin URL and root commit sha, so every member's clone matches. */
  repoKey: string;
  /** The full sha the session branched from. */
  baseCommit: string;
  /** "misty/live/<slug>". */
  branch: string;
  startedBy: { id: string; name: string };
  createdAt: string;
  endedAt: string | null;
  outcome: CodeSessionOutcome | null;
}

/** What going live sends. */
export interface NewCodeSession {
  name: string;
  repoKey: string;
  baseCommit: string;
  branch: string;
}


function codeSessionPath(spaceId: string, sessionId?: string): string {
  const base = `/spaces/${encodeURIComponent(spaceId)}/code-sessions`;
  return sessionId ? `${base}/${encodeURIComponent(sessionId)}` : base;
}

export const codeSessionsApi = {
  /** The Space's open sessions, newest first. */
  list: (spaceId: string) => spaceRequest<{ sessions: CodeSession[] }>(codeSessionPath(spaceId)),
  /** Goes live. A 409 means an open session already uses that branch of the repo. */
  create: (spaceId: string, session: NewCodeSession) =>
    spaceRequest<CodeSession>(codeSessionPath(spaceId), {
      method: "POST",
      body: JSON.stringify(session),
    }),
  /** One session, ended ones too. */
  get: (spaceId: string, sessionId: string) =>
    spaceRequest<CodeSession>(codeSessionPath(spaceId, sessionId)),
  /** Ends the session; only its starter may (403 otherwise, 409 if it already ended). */
  end: (spaceId: string, sessionId: string, outcome: CodeSessionOutcome) =>
    spaceRequest<CodeSession>(`${codeSessionPath(spaceId, sessionId)}/end`, {
      method: "POST",
      body: JSON.stringify({ outcome }),
    }),
};
