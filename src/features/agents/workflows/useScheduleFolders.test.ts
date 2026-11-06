import { beforeEach, expect, it } from "vitest";
import { useScheduleFolders } from "./useScheduleFolders";

const store = () => useScheduleFolders.getState();

beforeEach(() => useScheduleFolders.setState({ byWorkflow: {} }));

it("gives a workflow no folder until it's turned on", () => {
  expect(store().byWorkflow.method_a).toBeUndefined();
  store().set("method_a", { folderId: "scope_docs", writable: false });
  expect(store().byWorkflow.method_a).toEqual({ folderId: "scope_docs", writable: false });
  expect(store().byWorkflow.method_b).toBeUndefined();
});

it("removes the folder when it's turned off", () => {
  store().set("method_a", { folderId: "scope_docs", writable: true });
  store().set("method_a", null);
  expect(store().byWorkflow.method_a).toBeUndefined();
});
