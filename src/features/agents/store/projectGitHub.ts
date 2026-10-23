import { cachedRequest } from "@/api/cache/cached-request";
import { invoke } from "@tauri-apps/api/core";
import { apiRequest } from "@/api/client";

/** A repository on the person's connected GitHub account. */
export interface GitHubRepo {
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  url: string;
  cloneUrl: string;
  description?: string;
}

/** The person's repositories, most recently pushed first. */
export async function githubRepos(): Promise<GitHubRepo[]> {
  const result = await cachedRequest<{ repos: GitHubRepo[] }>("/integrations/github/repos");
  return result.repos;
}

/** Makes an empty repository on the connected account, private by default. */
export async function createGitHubRepo(input: {
  name: string;
  private: boolean;
}): Promise<GitHubRepo> {
  const result = await apiRequest<{ repo: GitHubRepo }>("/integrations/github/repos", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.repo;
}

/** Pushes a project to a repository with this computer's git and makes it `origin`. */
export async function publishProject(scopeId: string, cloneUrl: string): Promise<void> {
  await invoke("project_publish", { scopeId, cloneUrl });
}

/** Clones a repository into a new project folder the person picks. */
export async function cloneProject(
  repo: GitHubRepo,
): Promise<{ id: string; displayName: string } | null> {
  const { republishDeviceFolders } = await import("./useAgentsStore");
  const result = await invoke<{ id: string; displayName: string } | null>("project_clone", {
    cloneUrl: repo.cloneUrl,
    name: repo.name,
  });
  await republishDeviceFolders();
  return result;
}

/** The project's GitHub remote as owner/name, when it has one. */
export async function projectRemote(scopeId: string): Promise<string | null> {
  return invoke<string | null>("coding_project_remote", { scopeId }).catch(() => null);
}
