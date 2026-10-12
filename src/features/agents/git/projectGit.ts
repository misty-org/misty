import { invoke } from "@tauri-apps/api/core";
import { apiRequest } from "@/api/client";
import { useUserStore } from "@/features/auth/core";
import type { GitHubRepo, GitTransport } from "./gitSync";

/** A native result the model could fix comes back as a failure; here it's an error. */
function unwrap<T>(value: unknown): T {
  const failure = value as { status?: string; tool_error?: { message?: string } } | null;
  if (failure?.status === "failure")
    throw new Error(failure.tool_error?.message || "That Git step failed.");
  return value as T;
}

function message(error: unknown): string {
  if (typeof error === "string") return error.replace(/^[a-z_]+:\s*/, "");
  return error instanceof Error ? error.message : "That Git step failed.";
}

/** The app's transport: native steps through `code_git`, GitHub through the server. */
export function projectGit(scopeId: string): GitTransport {
  return {
    native: async (operation, input = {}) => {
      try {
        return unwrap(await invoke("code_git", { request: { operation, scopeId, input } }));
      } catch (error) {
        throw new Error(message(error));
      }
    },
    github: (op, args = {}) =>
      apiRequest("/integrations/github/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, args }),
      }),
  };
}

export interface GitIdentity {
  name: string;
  email: string;
  /** The GitHub login, when commits are by the connected GitHub account. */
  login?: string;
}

let identity: Promise<GitIdentity | null> | null = null;

/** Who commits are by: the connected GitHub account (its no-reply address),
 * or the Misty account before GitHub is connected. */
export async function commitAuthor(): Promise<GitIdentity> {
  identity ??= apiRequest<GitIdentity>("/integrations/github/git", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op: "identity" }),
  }).catch(() => null);
  const github = await identity;
  if (!github) identity = null;
  if (github) return github;
  const me = useUserStore.getState().me;
  if (!me?.email) throw new Error("Sign in to Misty to commit.");
  return { name: me.name || me.username || me.email, email: me.email };
}

/** Forget the cached author, after connecting or disconnecting GitHub. */
export function resetCommitAuthor() {
  identity = null;
}

export async function githubRepos(): Promise<
  (GitHubRepo & {
    private: boolean;
    defaultBranch: string;
    canPush: boolean;
    description?: string;
  })[]
> {
  const result = await apiRequest<{ repos: Awaited<ReturnType<typeof githubRepos>> }>(
    "/integrations/github/git",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "repos" }),
    },
  );
  return result.repos;
}
