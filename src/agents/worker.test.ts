import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentEventsAnswer, automaticSummaryAllowed, completionPayload, documentReference, promptForAgentJob, type ClaimedAgentJob } from "./worker";

const claim: ClaimedAgentJob = {
  job: {
    id: "job_00000000-0000-0000-0000-000000000001",
    agentId: "agent_00000000-0000-0000-0000-000000000001",
    deviceId: "device_00000000-0000-0000-0000-000000000001",
    triggerKind: "manual",
    state: "leased",
    payload: { prompt: "Summarize the new report" },
    expiresAt: "2030-01-01T00:00:00Z",
  },
  leaseToken: "lease-token-for-tests-1234567890",
};

describe("desktop agent worker contracts", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_MISTY_AGENTS_ENABLED", "true");
    vi.stubEnv("VITE_MISTY_DOCUMENTS_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("builds a read-only Mika prompt without device paths", () => {
    const prompt = promptForAgentJob(claim, { id: claim.job.agentId, scopeId: "scope_abcdefgh", name: "Reports", instructions: "Summarize incoming reports." });
    expect(prompt).toContain("Summarize the new report");
    expect(prompt).toContain("Summarize incoming reports.");
    expect(prompt).toContain("read-only");
    expect(prompt).not.toMatch(/\/Users\/|[A-Za-z]:\\/);
  });

  it("sanitizes completion citations to basename and coordinates", () => {
    const payload = completionPayload({
      answer: "Quarterly revenue increased.",
      creditsUsed: 0.02,
      citations: [{
        id: "citation-1",
        scopeId: "scope_abcdefgh",
        fileName: "report.pdf",
        relativePath: "private/report.pdf",
        kind: "pdf_page",
        label: "Page 4",
        page: 4,
      }],
    });
    expect(JSON.stringify(payload)).not.toContain("/Users/");
    expect(payload.citations).toEqual([{
      scopeId: "scope_abcdefgh",
      fileName: "report.pdf",
      relativePath: "private/report.pdf",
      label: "Page 4",
      kind: "pdf_page",
      page: 4,
    }]);
  });

  it("selects the most recent assistant answer", () => {
    expect(agentEventsAnswer([
      { sequence: 1, type: "assistant_message", text: "first", created_at: "now" },
      { sequence: 2, type: "assistant_message", text: "final", created_at: "now" },
    ])).toBe("final");
  });

  it("accepts only consented opaque-scope document references", () => {
    const documentClaim = { ...claim, job: { ...claim.job, payload: { scopeId: "scope_abcdefgh", fileName: "incoming/report.pdf" } } };
    expect(documentReference(documentClaim, {
      id: claim.job.agentId,
      scopeId: "scope_abcdefgh",
      name: "Reports",
      instructions: "Summarize reports.",
      cloudDocumentConsent: true,
    })).toEqual({ scopeId: "scope_abcdefgh", relativePath: "incoming/report.pdf" });
    expect(documentReference(documentClaim, {
      id: claim.job.agentId,
      scopeId: "scope_abcdefgh",
      name: "Reports",
      instructions: "Summarize reports.",
      cloudDocumentConsent: false,
    })).toBeNull();
    expect(documentReference(documentClaim, {
      id: claim.job.agentId,
      scopeId: "scope_different",
      name: "Reports",
      instructions: "Summarize reports.",
      cloudDocumentConsent: true,
    })).toBeNull();
  });

  it("never grants a non-owner job automatic artifact writes", () => {
    const memberClaim = { ...claim, job: { ...claim.job, triggerKind: "file_created", requesterUserId: "member" } };
    const definition = { id: claim.job.agentId, scopeId: "scope_abcdefgh", name: "Reports", instructions: "Summarize.", ownerUserId: "owner", trustPolicy: { automaticActions: ["create_file"] } };
    expect(automaticSummaryAllowed(memberClaim, definition)).toBe(false);
    expect(automaticSummaryAllowed({ ...memberClaim, job: { ...memberClaim.job, requesterUserId: "owner" } }, definition)).toBe(true);
    expect(automaticSummaryAllowed({ ...memberClaim, job: { ...memberClaim.job, requesterUserId: "owner" } }, {
      ...definition,
      workflow: { version: 1, revision: 1, nodes: [{ id: "task", kind: "mika_task", config: {}, policy: [] }], edges: [] },
    })).toBe(false);
  });
});
