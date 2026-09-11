import { beforeEach, expect, it, vi } from "vitest";
vi.mock("./nativeNotifications", () => ({
  publishNativeActivity: vi.fn(),
  syncNativeBadge: vi.fn(),
}));
vi.mock("@/features/spaces", () => ({ useSpacesStore: { getState: () => ({}) } }));
import { createOperationActivityObserver } from "./operationActivity";
import { useActivityStore } from "./useActivityStore";
import type { OperationQueueSnapshot, OperationDescriptor } from "@/native/contracts";
const op = (id: number, status: OperationDescriptor["status"]) =>
  ({ operationId: id, batchId: 10, kind: "copy", status }) as OperationDescriptor;
const snapshot = (operations: OperationDescriptor[]) =>
  ({ operations, batches: [{ batchId: 10, label: "Copy files" }] }) as OperationQueueSnapshot;
beforeEach(() => {
  localStorage.clear();
  useActivityStore.setState(useActivityStore.getInitialState(), true);
  useActivityStore.getState().setAccount("account");
});
it("groups jobs by batch, waits for all files, and resolves retry state on the same entry", () => {
  const observe = createOperationActivityObserver();
  observe(snapshot([]), "account");
  observe(snapshot([op(1, "completed"), op(2, "in_progress")]), "account");
  expect(useActivityStore.getState().attentionCount).toBe(0);
  observe(snapshot([op(1, "completed"), op(2, "failed")]), "account");
  expect(useActivityStore.getState().attentionCount).toBe(1);
  observe(snapshot([op(1, "completed"), op(2, "in_progress")]), "account");
  expect(useActivityStore.getState().attentionCount).toBe(0);
  observe(snapshot([op(1, "completed"), op(2, "completed")]), "account");
  expect(useActivityStore.getState().allItems).toHaveLength(1);
  expect(useActivityStore.getState().attentionItems[0].kind).toBe("completion");
});
it("does not claim old native device jobs for a freshly logged-in account", () => {
  const observe = createOperationActivityObserver();
  observe(snapshot([op(1, "in_progress")]), "account");
  observe(snapshot([op(1, "completed")]), "account");
  expect(useActivityStore.getState().allItems).toEqual([]);
});
