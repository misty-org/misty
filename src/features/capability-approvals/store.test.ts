import { beforeEach, expect, it, vi } from "vitest";
import { useCapabilityApprovals } from "./store";
import { capabilityApprovalsApi, type CapabilityApprovalSummary } from "./api";
vi.mock("./api", () => ({ capabilityApprovalsApi: { list: vi.fn() } }));
const summary = (id: string): CapabilityApprovalSummary => ({
  id,
  run_id: "invocation_10000000-0000-4000-8000-000000000001",
  tool_name: "sdk.fixture",
  summary: "Allow habit record?",
  expires_at: "2099-01-01T00:00:00Z",
  created_at: "2026-09-07T00:00:00Z",
});
beforeEach(() => {
  useCapabilityApprovals.getState().setAccount("");
  vi.clearAllMocks();
});
it("discards delayed results after account switching", async () => {
  let finish!: (value: { approvals: CapabilityApprovalSummary[] }) => void;
  vi.mocked(capabilityApprovalsApi.list).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  useCapabilityApprovals.getState().setAccount("first");
  const waiting = useCapabilityApprovals.getState().refresh();
  useCapabilityApprovals.getState().setAccount("second");
  finish({ approvals: [summary("first-user-action")] });
  await waiting;
  expect(useCapabilityApprovals.getState().items).toEqual([]);
  expect(useCapabilityApprovals.getState().accountId).toBe("second");
});
it("loads every page and deduplicates overlapping responses", async () => {
  vi.mocked(capabilityApprovalsApi.list)
    .mockResolvedValueOnce({ approvals: [summary("one")], nextCursor: "one" })
    .mockResolvedValueOnce({ approvals: [summary("one"), summary("two")] });
  useCapabilityApprovals.getState().setAccount("account");
  await useCapabilityApprovals.getState().refresh();
  await useCapabilityApprovals.getState().loadMore();
  expect(useCapabilityApprovals.getState().items.map((item) => item.id)).toEqual(["one", "two"]);
  expect(useCapabilityApprovals.getState().nextCursor).toBe("");
});
