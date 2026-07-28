import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpacesRealtimeBridge } from "@/features/spaces/SpacesRealtimeBridge";

const mocks = vi.hoisted(() => ({
  auth: {
    user: { id: "user-1" } as { id: string } | null,
    transitioning: false,
  },
  spaces: {
    loading: false,
    error: null as string | null,
    load: vi.fn(async () => undefined),
    loadInbox: vi.fn(async () => undefined),
    connectRealtime: vi.fn(async () => undefined),
    disconnectRealtime: vi.fn(),
    clearError: vi.fn(),
  },
  explorer: {
    recordActivity: vi.fn(),
  },
}));

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/stores/spaces/useSpacesStore", () => ({
  useSpacesStore: Object.assign(
    (selector: (state: typeof mocks.spaces) => unknown) => selector(mocks.spaces),
    { getState: () => mocks.spaces },
  ),
}));

vi.mock("@/stores/explorer", () => ({
  useExplorerStore: (selector: (state: typeof mocks.explorer) => unknown) =>
    selector(mocks.explorer),
}));

describe("SpacesRealtimeBridge", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.auth.user = { id: "user-1" };
    mocks.auth.transitioning = false;
    mocks.spaces.loading = false;
    mocks.spaces.error = null;
    mocks.spaces.load.mockClear();
    mocks.spaces.loadInbox.mockClear();
    mocks.spaces.connectRealtime.mockClear();
    mocks.spaces.disconnectRealtime.mockClear();
    mocks.spaces.clearError.mockClear();
    mocks.explorer.recordActivity.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    container.remove();
  });

  it("pauses Space requests while the account is switching", async () => {
    mocks.auth.transitioning = true;

    await act(async () => {
      root.render(<SpacesRealtimeBridge />);
    });

    expect(mocks.spaces.disconnectRealtime).toHaveBeenCalled();
    expect(mocks.spaces.connectRealtime).not.toHaveBeenCalled();
    expect(mocks.spaces.load).not.toHaveBeenCalled();
    expect(mocks.spaces.loadInbox).not.toHaveBeenCalled();
  });

  it("records a settled load failure in Activity without surfacing it immediately", async () => {
    mocks.spaces.error = "Load failed";

    await act(async () => {
      root.render(<SpacesRealtimeBridge />);
    });
    await act(async () => vi.advanceTimersByTime(1_199));
    expect(mocks.explorer.recordActivity).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(1));
    expect(mocks.explorer.recordActivity).toHaveBeenCalledWith(
      "Spaces couldn’t refresh. Check your connection and try again.",
      "error",
    );
  });

  it("silently clears account-switch handoff errors", async () => {
    mocks.spaces.error = "Wait for the account switch to finish.";

    await act(async () => {
      root.render(<SpacesRealtimeBridge />);
    });

    expect(mocks.spaces.clearError).toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(mocks.explorer.recordActivity).not.toHaveBeenCalled();
  });
});
