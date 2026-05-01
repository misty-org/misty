import { beforeEach, describe, expect, it } from "vitest";
import { useExplorerStore } from "../../store";

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
