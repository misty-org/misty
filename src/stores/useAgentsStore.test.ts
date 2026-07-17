import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDefinition, AgentSnapshot } from "../agents/types";
import { defaultAgentTrustPolicy, emptyAgentSnapshot } from "../agents/types";

const api = vi.hoisted(() => ({
  fetchServerAgentSnapshot: vi.fn(),
  saveServerAgentDefinition: vi.fn(),
  deleteServerAgentDefinition: vi.fn(),
  resolveServerAgentApproval: vi.fn(),
  cancelServerAgentJob: vi.fn(),
  retryServerAgentJob: vi.fn(),
}));

vi.mock("../shared/tauri", () => ({ hasTauriInternals: () => false }));
vi.mock("../agents/api", () => ({
  agentsSnapshot: vi.fn(),
  agentsRegisterFolderScope: vi.fn(),
  agentsSaveDefinition: vi.fn(),
  agentsDeleteDefinition: vi.fn(),
  agentsResolveApproval: vi.fn(),
  agentsCancelJob: vi.fn(),
  ...api,
}));

import { useAgentsStore } from "./useAgentsStore";

describe("useAgentsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentsStore.setState({
      snapshot: emptyAgentSnapshot(),
      loading: false,
      saving: false,
      error: null,
      syncNotice: null,
      draft: null,
      selectedAgentId: null,
    });
  });

  it("loads the cloud snapshot when the local runtime is unavailable", async () => {
    const definition = fixtureDefinition();
    api.fetchServerAgentSnapshot.mockResolvedValue(fixtureSnapshot(definition));

    await useAgentsStore.getState().load();

    expect(useAgentsStore.getState().snapshot.definitions).toEqual([definition]);
    expect(useAgentsStore.getState().selectedAgentId).toBe(definition.id);
    expect(useAgentsStore.getState().syncNotice).toContain("cloud data");
  });

  it("saves definitions without placing a local path in the server payload", async () => {
    const definition = fixtureDefinition();
    api.saveServerAgentDefinition.mockResolvedValue(definition);

    await useAgentsStore.getState().saveDefinition(definition);

    expect(api.saveServerAgentDefinition).toHaveBeenCalledWith(definition);
    expect(api.saveServerAgentDefinition.mock.calls[0][0].scope.relativePath).toBeNull();
    expect(useAgentsStore.getState().snapshot.definitions[0]).toEqual(definition);
  });

  it("requeues the same run when a failed run is retried", async () => {
    const retried = {
      id: "job-failed", agentId: "agent-1", deviceId: "device-1", requesterAccountId: "account-1",
      triggerKind: "file_created" as const, status: "queued" as const, createdAt: "2026-07-14T12:01:00.000Z",
      updatedAt: "2026-07-14T12:01:00.000Z", expiresAt: "2026-07-21T12:01:00.000Z",
      events: [], artifactIds: [],
    };
    useAgentsStore.setState((state) => ({
      snapshot: {
        ...state.snapshot,
        jobs: [{ ...retried, status: "failed", error: "Load failed" }],
      },
    }));
    api.retryServerAgentJob.mockResolvedValue(retried);

    await useAgentsStore.getState().retryJob("job-failed");

    expect(api.retryServerAgentJob).toHaveBeenCalledWith("job-failed");
    expect(useAgentsStore.getState().snapshot.jobs).toEqual([retried]);
  });
});

function fixtureDefinition(): AgentDefinition {
  const now = "2026-07-14T12:00:00.000Z";
  return {
    id: "agent-1",
    spaceId: "space-1",
    ownerAccountId: "account-1",
    deviceId: "device-1",
    scope: {
      id: "scope-1",
      deviceId: "device-1",
      displayName: "Reports",
      kind: "local_folder",
      relativePath: null,
      available: true,
    },
    name: "Reports agent",
    instructions: "Summarize new reports with citations.",
    status: "draft",
    cloudDocumentConsent: true,
    members: [],
    triggers: [{ id: "trigger-1", kind: "manual", enabled: true }],
    trustPolicy: defaultAgentTrustPolicy(),
    workflow: { version: 1, revision: 1, nodes: [], edges: [] },
    workflowId: null,
    workflowRevision: 1,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function fixtureSnapshot(definition: AgentDefinition): AgentSnapshot {
  return {
    version: 1,
    device: null,
    scopes: [definition.scope],
    definitions: [definition],
    jobs: [],
    approvals: [],
    artifacts: [],
    loadedAt: "2026-07-14T12:00:00.000Z",
  };
}
