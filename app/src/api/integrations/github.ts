import { spaceRequest } from "@/api/spaces/api";

export type GitHubHealthStatus = "active" | "pending" | "needs_attention" | "suspended";

export interface GitHubInstallation {
  id: string;
  space_id: string;
  integration_id: string;
  installed_by_user_id: string;
  installation_id: number;
  account_id: number;
  account_login: string;
  account_type: string;
  repository_selection: "all" | "selected";
  permissions: Record<string, string>;
  events: string[];
  status: GitHubHealthStatus | "disabled";
  last_error_code?: string;
  suspended_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface GitHubRepository {
  id: number;
  full_name: string;
  default_branch: string;
  clone_url: string;
  html_url: string;
  private: boolean;
  permissions: Record<string, boolean>;
}

export interface GitHubCodeWorkspace {
  id: string;
  space_id: string;
  installation_id: string;
  shared_resource_id: string;
  bound_by_user_id: string;
  repository_id: number;
  full_name: string;
  default_branch: string;
  clone_url: string;
  html_url: string;
  private: boolean;
  client_workspace_id?: string;
  permissions: Record<string, boolean>;
  sync_cursor?: string;
  status: GitHubHealthStatus | "disabled";
  last_error_code?: string;
  last_synced_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type GitHubRecordType = "repository" | "branch" | "commit" | "issue" | "pull_request";

export interface GitHubRepositoryRecord {
  id: string;
  workspace_id: string;
  record_type: GitHubRecordType;
  external_id: string;
  parent_external_id?: string;
  ref_name?: string;
  sha?: string;
  number?: number | null;
  state?: string;
  title?: string;
  url?: string;
  actor_login?: string;
  provenance?: Record<string, unknown>;
  occurred_at?: string | null;
}

export interface GitHubMutationInput {
  operation: "create_issue" | "comment_issue" | "create_branch" | "create_pull_request";
  confirmed: true;
  payload: Record<string, unknown>;
}

const integrationBase = (spaceId: string) =>
  `/spaces/${encodeURIComponent(spaceId)}/integrations/github`;
const codeBase = (spaceId: string) => `/spaces/${encodeURIComponent(spaceId)}/code/github`;

export const githubCodeApi = {
  beginInstall: (spaceId: string, returnTo = "/code") =>
    spaceRequest<{ provider: "github"; installation_url: string; state_expires_at: string }>(
      `${integrationBase(spaceId)}/install`,
      { method: "POST", body: JSON.stringify({ return_to: returnTo }) },
    ),

  installations: (spaceId: string) =>
    spaceRequest<{ installations: GitHubInstallation[] }>(
      `${integrationBase(spaceId)}/installations`,
    ),

  disconnect: (spaceId: string, installationId: string) =>
    spaceRequest<void>(
      `${integrationBase(spaceId)}/installations/${encodeURIComponent(installationId)}`,
      { method: "DELETE" },
    ),

  repositories: (spaceId: string, installationId: string) =>
    spaceRequest<{ repositories: GitHubRepository[] }>(
      `${integrationBase(spaceId)}/installations/${encodeURIComponent(installationId)}/repositories`,
    ),

  workspaces: (spaceId: string) =>
    spaceRequest<{ workspaces: GitHubCodeWorkspace[] }>(`${codeBase(spaceId)}/workspaces`),

  bindWorkspace: (
    spaceId: string,
    installationId: string,
    repositoryId: number,
    clientWorkspaceId: string,
  ) =>
    spaceRequest<{ workspace: GitHubCodeWorkspace; records_synced: number }>(
      `${codeBase(spaceId)}/workspaces`,
      {
        method: "POST",
        body: JSON.stringify({
          installation_id: installationId,
          repository_id: repositoryId,
          client_workspace_id: clientWorkspaceId,
        }),
      },
    ),

  unlinkWorkspace: (spaceId: string, workspaceId: string) =>
    spaceRequest<void>(`${codeBase(spaceId)}/workspaces/${encodeURIComponent(workspaceId)}`, {
      method: "DELETE",
    }),

  syncWorkspace: (spaceId: string, workspaceId: string) =>
    spaceRequest<{ workspace: GitHubCodeWorkspace; records_synced: number }>(
      `${codeBase(spaceId)}/workspaces/${encodeURIComponent(workspaceId)}/sync`,
      { method: "POST" },
    ),

  records: (spaceId: string, workspaceId: string, recordType = "") => {
    const query = new URLSearchParams({ limit: "100" });
    if (recordType) query.set("record_type", recordType);
    return spaceRequest<{ records: GitHubRepositoryRecord[] }>(
      `${codeBase(spaceId)}/workspaces/${encodeURIComponent(workspaceId)}/records?${query}`,
    );
  },

  createHandoff: (spaceId: string, workspaceId: string) =>
    spaceRequest<{ handoff: string; redeem_path: string; expires_at: string }>(
      `${codeBase(spaceId)}/workspaces/${encodeURIComponent(workspaceId)}/credential-handoff`,
      { method: "POST" },
    ),

  mutate: (spaceId: string, workspaceId: string, input: GitHubMutationInput) =>
    spaceRequest<{ operation: GitHubMutationInput["operation"]; result: Record<string, unknown> }>(
      `${codeBase(spaceId)}/workspaces/${encodeURIComponent(workspaceId)}/actions`,
      { method: "POST", body: JSON.stringify(input) },
    ),
};
