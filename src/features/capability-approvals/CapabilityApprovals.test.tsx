import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CapabilityApprovalDetail } from "./CapabilityApprovals";
import { capabilityApprovalsApi, type CapabilityApprovalReview } from "./api";
import { useCapabilityApprovals } from "./store";
vi.mock("./api", () => ({
  capabilityApprovalsApi: {
    review: vi.fn(),
    decide: vi.fn(),
    list: vi.fn(async () => ({ approvals: [] })),
  },
}));
const fixture = (): CapabilityApprovalReview => ({
  approval: {
    id: "10000000-0000-4000-8000-000000000001",
    run_id: "invocation_10000000-0000-4000-8000-000000000002",
    state: "pending",
    expires_at: "2099-01-01T00:00:00Z",
  },
  review: {
    execution: {
      requestId: "10000000-0000-4000-8000-000000000003",
      runId: "10000000-0000-4000-8000-000000000002",
      effectId: "10000000-0000-4000-8000-000000000004",
      capability: "habits.record",
      capabilityVersion: 1,
      providerId: "example.habits/backend",
      providerVersion: 1,
      targetId: "10000000-0000-4000-8000-000000000005",
      targetRevision: 1,
      input: { habit: "Walk <script>alert(1)</script>", note: "健康" },
      deadline: "2099-01-01T00:00:00Z",
      grantIds: [],
    },
    target: {
      id: "10000000-0000-4000-8000-000000000005",
      revision: 1,
      appId: "example.habits",
      providerId: "example.habits/backend",
      providerVersion: 1,
      label: "Personal habit account",
      binding: { kind: "backend", connectionId: "10000000-0000-4000-8000-000000000006" },
    },
    effects: { kind: "write", incidental: [], approval: "scoped", retry: "reconcile" },
    description: "Record habit",
  },
});
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(capabilityApprovalsApi.review).mockResolvedValue(fixture());
  vi.mocked(capabilityApprovalsApi.decide).mockResolvedValue(undefined);
  useCapabilityApprovals.getState().setAccount("");
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});
const button = (text: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === text)!;
const render = () =>
  act(async () =>
    root.render(<CapabilityApprovalDetail id={fixture().approval.id} onClose={() => {}} />),
  );
it("shows exact plain-text input and prevents concurrent decisions", async () => {
  let finish!: () => void;
  vi.mocked(capabilityApprovalsApi.decide).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  expect(container.textContent).toContain("Personal habit account");
  expect(container.textContent).toContain("健康");
  expect(container.querySelector("script")).toBeNull();
  await act(async () => {
    button("Approve this action").click();
    button("Approve this action").click();
  });
  expect(capabilityApprovalsApi.decide).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(container.textContent).toContain("recheck permissions");
  expect(button("Approve this action")).toBeUndefined();
});
it("blocks decisions after an unreadable or expired review", async () => {
  vi.mocked(capabilityApprovalsApi.review).mockRejectedValueOnce(new Error("offline"));
  await render();
  expect(button("Approve this action")).toBeUndefined();
  expect(button("Reload action")).toBeTruthy();
  const expired = fixture();
  expired.approval.expires_at = "2000-01-01T00:00:00Z";
  vi.mocked(capabilityApprovalsApi.review).mockResolvedValue(expired);
  await act(async () => button("Reload action").click());
  expect(container.textContent).toContain("expired");
  expect(button("Approve this action")).toBeUndefined();
});
it("requires a fresh review after a lost decision response", async () => {
  vi.mocked(capabilityApprovalsApi.decide).mockRejectedValueOnce(new Error("lost response"));
  await render();
  await act(async () => button("Deny").click());
  expect(container.textContent).toContain("was not confirmed");
  expect(button("Approve this action")).toBeUndefined();
  const approved = fixture();
  approved.approval.state = "approved";
  vi.mocked(capabilityApprovalsApi.review).mockResolvedValue(approved);
  await act(async () => button("Reload action").click());
  expect(container.textContent).toContain("was approved");
  expect(capabilityApprovalsApi.decide).toHaveBeenCalledTimes(1);
});

it("shows browser page and exact input as untrusted plain text", async () => {
  const value = fixture();
  value.review = {
    kind: "browser",
    runId: value.approval.run_id,
    effectId: value.approval.id,
    callId: "fill-original",
    operation: "browser.interact",
    input: {
      scopeId: "opaque-view",
      documentId: value.approval.id,
      action: { kind: "fill", elementRef: "saved-ref", text: "Reviewed message" },
    },
    target: {
      contextId: "context-original",
      deviceId: "device-original",
      scopeId: "opaque-view",
      label: "Personal inbox",
      expiresAt: "2099-01-01T00:00:00Z",
    },
    pageUrl: "https://example.org/inbox",
    pageTitle: "Inbox <script>fake instruction</script>",
    elementLabel: "Message",
    deadline: "2099-01-01T00:00:00Z",
  };
  vi.mocked(capabilityApprovalsApi.review).mockResolvedValueOnce(value);
  await render();
  expect(container.textContent).toContain("Personal inbox");
  expect(container.textContent).toContain("https://example.org/inbox");
  expect(container.textContent).toContain("Reviewed message");
  expect(container.textContent).toContain("fake instruction");
  expect(container.querySelector("script")).toBeNull();
  await act(async () => button("Approve this action").click());
  expect(capabilityApprovalsApi.decide).toHaveBeenCalledWith(value, true);
});
