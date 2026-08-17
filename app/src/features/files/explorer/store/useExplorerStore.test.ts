import { beforeEach, describe, expect, it } from "vitest";
import type { NativeWorkspaceDocument } from "@/native/contracts";
import { useExplorerStore, workspaceMetadata } from "../store";

describe("Explorer operation notices", () => {
  beforeEach(() => {
    useExplorerStore.setState({ operationError: null });
  });

  it("consumes a recovery notice exactly once", () => {
    const message = "Misty reset a damaged Explorer layout and opened a clean file pane.";
    useExplorerStore.setState({ operationError: message });

    expect(useExplorerStore.getState().consumeOperationError()).toBe(message);
    expect(useExplorerStore.getState().operationError).toBeNull();
    expect(useExplorerStore.getState().consumeOperationError()).toBeNull();
  });
});

describe("Explorer profile labels", () => {
  it("presents legacy default workspace names as profiles", () => {
    const document = {
      active_workspace_id: "workspace_0",
      workspaces: [
        { id: "workspace_0", title: "Workspace 1" },
        { id: "workspace_1", title: "Client files" },
      ],
    } as NativeWorkspaceDocument;

    expect(workspaceMetadata(document)).toEqual({
      workspaceEntries: [
        { id: "workspace_0", title: "Profile 1" },
        { id: "workspace_1", title: "Client files" },
      ],
      activeWorkspaceId: "workspace_0",
      activeWorkspaceTitle: "Profile 1",
    });
  });
});
