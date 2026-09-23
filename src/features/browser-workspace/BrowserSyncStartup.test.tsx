import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  unlock: vi.fn(),
  availability: vi.fn(),
  setState: vi.fn(),
}));

vi.mock("@/api/deployment/api", () => ({
  resolveApiBase: vi.fn(async () => "https://misty.example/v1"),
}));
vi.mock("@/api/client/session", () => ({
  isApiSessionTransitioning: vi.fn(() => false),
  readApiSessionGeneration: vi.fn(() => 1),
}));
vi.mock("@/features/workspace/workspaceRecoveryPlatform", () => ({
  nativeWorkspaceRecoveryEnabled: vi.fn(() => true),
}));
vi.mock("./native", () => ({
  readNativeSync: mocks.read,
  unlockNativeSync: mocks.unlock,
  vaultAvailability: mocks.availability,
}));
vi.mock("./store", () => ({
  useBrowserSyncStore: { setState: mocks.setState },
}));

import { BrowserSyncStartup } from "./BrowserSyncStartup";

describe("BrowserSyncStartup", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("never blocks the application while sync startup is pending", async () => {
    mocks.read.mockReturnValue(new Promise(() => undefined));
    await act(async () => {
      root.render(
        <BrowserSyncStartup accountId="account-1">
          <div>Local workspace</div>
        </BrowserSyncStartup>,
      );
    });
    expect(container.textContent).toBe("Local workspace");
  });

  it("restarts a terminal remembered session in the background", async () => {
    const existing = {
      account_id: "account-1",
      deployment: "https://misty.example/v1",
      status: { phase: "attention" },
    };
    const restarted = { ...existing, status: { phase: "connecting" } };
    mocks.read.mockResolvedValue(existing);
    mocks.unlock.mockResolvedValue(restarted);
    await act(async () => {
      root.render(
        <BrowserSyncStartup accountId="account-1">
          <div>Local workspace</div>
        </BrowserSyncStartup>,
      );
    });
    expect(mocks.unlock).toHaveBeenCalledWith(
      { apiBase: "https://misty.example/v1", accountId: "account-1" },
      null,
      null,
      false,
    );
    expect(mocks.setState).toHaveBeenCalledWith({ session: restarted, issue: null });
  });

  it("drops a stale terminal session when automatic unlock needs user input", async () => {
    mocks.read.mockResolvedValue({
      account_id: "account-1",
      deployment: "https://misty.example/v1",
      status: { phase: "stopped" },
    });
    mocks.unlock.mockRejectedValue(new Error("Enter your sync password."));
    await act(async () => {
      root.render(
        <BrowserSyncStartup accountId="account-1">
          <div>Local workspace</div>
        </BrowserSyncStartup>,
      );
    });
    expect(container.textContent).toBe("Local workspace");
    expect(mocks.setState).toHaveBeenCalledWith({
      session: null,
      issue: "Enter your sync password.",
    });
  });
});
