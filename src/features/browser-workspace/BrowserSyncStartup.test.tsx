import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  unlock: vi.fn(),
  credentials: vi.fn(),
  generation: 1,
  transitioning: false,
  setState: vi.fn(),
}));

vi.mock("@/api/deployment/api", () => ({
  resolveApiBase: vi.fn(async () => "https://misty.example/v1"),
}));
vi.mock("@/api/client/session", () => ({
  isApiSessionTransitioning: () => mocks.transitioning,
  readApiSessionGeneration: () => mocks.generation,
  readApiAuthToken: mocks.credentials,
}));
vi.mock("@/features/workspace/workspaceRecoveryPlatform", () => ({
  nativeWorkspaceRecoveryEnabled: vi.fn(() => true),
}));
vi.mock("./native", () => ({
  readNativeSync: mocks.read,
  unlockNativeSync: mocks.unlock,
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
    vi.resetAllMocks();
    vi.useFakeTimers();
    mocks.generation = 1;
    mocks.transitioning = false;
    mocks.credentials.mockResolvedValue("cookie-session:account-1");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
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

  async function mount(accountId = "account-1") {
    await act(async () => {
      root.render(<BrowserSyncStartup accountId={accountId}>Workspace</BrowserSyncStartup>);
    });
  }

  it("waits for saved JWT restoration before opening with the client key", async () => {
    let restored!: () => void;
    mocks.credentials.mockReturnValue(
      new Promise<void>((resolve) => {
        restored = resolve;
      }),
    );
    mocks.read.mockResolvedValue(null);
    mocks.unlock.mockResolvedValue({ account_id: "account-1" });
    await mount();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.unlock).not.toHaveBeenCalled();
    await act(async () => restored());
    expect(mocks.unlock).toHaveBeenCalledWith(
      { apiBase: "https://misty.example/v1", accountId: "account-1" },
      null,
      null,
      false,
    );
  });

  it("retries a failed start without settings being open", async () => {
    const opened = { account_id: "account-1" };
    mocks.read.mockResolvedValue(null);
    mocks.unlock.mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(opened);
    await mount();
    expect(mocks.unlock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(mocks.unlock).toHaveBeenCalledTimes(2);
    expect(mocks.setState).toHaveBeenCalledWith({ session: opened, issue: null });
  });

  it("retries immediately when connectivity returns and coalesces attempts", async () => {
    mocks.read.mockResolvedValue(null);
    mocks.unlock.mockRejectedValueOnce(new Error("Offline"));
    await mount();
    mocks.unlock.mockReturnValue(new Promise(() => undefined));
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mocks.unlock).toHaveBeenCalledTimes(2);
  });

  it("leaves live workers to reconnect, but restarts workers that exit later", async () => {
    mocks.read.mockResolvedValue({
      account_id: "account-1",
      deployment: "https://misty.example/v1",
      status: { phase: "offline" },
    });
    await mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mocks.unlock).not.toHaveBeenCalled();
    mocks.read.mockResolvedValue({
      account_id: "account-1",
      deployment: "https://misty.example/v1",
      status: { phase: "attention" },
    });
    mocks.unlock.mockResolvedValue({ account_id: "account-1" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mocks.unlock).toHaveBeenCalledTimes(1);
  });

  it("discards late results and stops retries after an account change", async () => {
    let opened!: (value: unknown) => void;
    mocks.read.mockResolvedValue(null);
    mocks.unlock.mockReturnValue(
      new Promise((resolve) => {
        opened = resolve;
      }),
    );
    await mount();
    mocks.generation += 1;
    mocks.setState.mockClear();
    await act(async () => {
      opened({ account_id: "account-1" });
      await vi.advanceTimersByTimeAsync(60_000);
      window.dispatchEvent(new Event("online"));
    });
    expect(mocks.setState).not.toHaveBeenCalled();
    expect(mocks.unlock).toHaveBeenCalledTimes(1);
  });

  it("cancels retries when unmounted", async () => {
    mocks.read.mockResolvedValue(null);
    mocks.unlock.mockRejectedValue(new Error("Offline"));
    await mount();
    await act(async () => {
      root.render(null);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      window.dispatchEvent(new Event("online"));
    });
    expect(mocks.unlock).toHaveBeenCalledTimes(1);
  });
});
