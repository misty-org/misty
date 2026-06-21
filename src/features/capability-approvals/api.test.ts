import { beforeEach, expect, it, vi } from "vitest";
import { apiRequest } from "@/api/client";
import { capabilityApprovalsApi } from "./api";
vi.mock("@/api/client", () => ({ apiRequest: vi.fn() }));
const id = "10000000-0000-4000-8000-000000000001";
const fixture = () => ({
  approval: {
    id,
    run_id: `invocation_${id}`,
    state: "pending",
    expires_at: "2099-01-01T00:00:00Z",
  },
  review: {
    execution: {
      requestId: id,
      runId: id,
      effectId: id,
      capability: "habits.record",
      capabilityVersion: 1,
      providerId: "example.habits/backend",
      providerVersion: 1,
      targetId: id,
      targetRevision: 1,
      input: { habit: "Walk" },
      deadline: "2099-01-01T00:00:00Z",
      grantIds: [],
    },
    target: {
      id,
      revision: 1,
      appId: "example.habits",
      providerId: "example.habits/backend",
      providerVersion: 1,
      label: "Personal habits",
      binding: { kind: "backend", connectionId: id },
    },
    effects: { kind: "write", incidental: [], approval: "scoped", retry: "reconcile" },
    description: "Record habit",
  },
});
beforeEach(() => vi.clearAllMocks());
it("validates the exact binding before exposing a review", async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce(fixture());
  const value = await capabilityApprovalsApi.review(id);
  if (value.review.kind === "browser") throw new Error("Expected SDK review");
  expect(value.review.execution.input).toEqual({ habit: "Walk" });
  const wrong = fixture();
  wrong.review.target.revision = 2;
  vi.mocked(apiRequest).mockResolvedValueOnce(wrong);
  await expect(capabilityApprovalsApi.review(id)).rejects.toThrow("action changed");
});
it("routes exact individual decisions to their authoritative run", async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce(fixture());
  const review = await capabilityApprovalsApi.review(id);
  await capabilityApprovalsApi.decide(review, true);
  expect(apiRequest).toHaveBeenLastCalledWith(`/me/sdk-runs/${id}/approvals/${id}`, {
    method: "POST",
    body: '{"approved":true}',
  });
  const conversation = {
    ...review,
    approval: { ...review.approval, id: `approval_${id}`, run_id: `run_${id}` },
  };
  await capabilityApprovalsApi.decide(conversation, false);
  expect(apiRequest).toHaveBeenLastCalledWith(`/agent-runs/run_${id}/approvals/approval_${id}`, {
    method: "POST",
    body: '{"decision":"deny"}',
  });
});

it("binds browser reviews and decisions to the original invocation", async () => {
  const browser = {
    approval: fixture().approval,
    review: {
      kind: "browser",
      runId: `invocation_${id}`,
      effectId: id,
      callId: "click-original",
      operation: "browser.click",
      input: { scopeId: "opaque-view", elementRef: "saved-ref" },
      target: {
        contextId: "context-original",
        deviceId: "device-original",
        scopeId: "opaque-view",
        label: "Personal inbox",
        expiresAt: "2099-01-01T00:00:00Z",
      },
      pageUrl: "https://example.org/inbox",
      pageTitle: "Inbox",
      elementLabel: "Send",
      deadline: "2099-01-01T00:00:00Z",
    },
  };
  vi.mocked(apiRequest).mockResolvedValueOnce(browser);
  const value = await capabilityApprovalsApi.review(id);
  expect(value.review.kind).toBe("browser");
  await capabilityApprovalsApi.decide(value, true);
  expect(apiRequest).toHaveBeenLastCalledWith(`/me/sdk-runs/${id}/approvals/${id}`, {
    method: "POST",
    body: '{"approved":true}',
  });
  browser.review.runId = "invocation_20000000-0000-4000-8000-000000000001";
  vi.mocked(apiRequest).mockResolvedValueOnce(browser);
  await expect(capabilityApprovalsApi.review(id)).rejects.toThrow("action changed");
});
