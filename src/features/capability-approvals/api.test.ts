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
});
beforeEach(() => vi.clearAllMocks());
it("lists through the first-party Agent endpoint", async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ approvals: [] });
  await capabilityApprovalsApi.list();
  expect(apiRequest).toHaveBeenCalledWith("/me/agent-approvals?limit=20", { signal: undefined });
});
it("binds the review and decision to the original browser invocation", async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce(fixture());
  const value = await capabilityApprovalsApi.review(id);
  await capabilityApprovalsApi.decide(value, true);
  expect(apiRequest).toHaveBeenLastCalledWith(`/me/agent-invocations/${id}/approvals/${id}`, {
    method: "POST",
    body: '{"approved":true}',
  });
  const wrong = fixture();
  wrong.review.runId = "invocation_20000000-0000-4000-8000-000000000001";
  vi.mocked(apiRequest).mockResolvedValueOnce(wrong);
  await expect(capabilityApprovalsApi.review(id)).rejects.toThrow("action changed");
});
it("preserves decisions for ordinary Agent runs", async () => {
  const input = fixture();
  input.approval.run_id = input.review.runId = `run_${id}`;
  vi.mocked(apiRequest).mockResolvedValueOnce(input);
  const value = await capabilityApprovalsApi.review(id);
  await capabilityApprovalsApi.decide(value, false);
  expect(apiRequest).toHaveBeenLastCalledWith(`/agent-runs/run_${id}/approvals/${id}`, {
    method: "POST",
    body: '{"decision":"deny"}',
  });
});
it("rejects retired SDK reviews", async () => {
  const input = fixture();
  input.review.kind = "sdk";
  vi.mocked(apiRequest).mockResolvedValueOnce(input);
  await expect(capabilityApprovalsApi.review(id)).rejects.toThrow();
});
