import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generation: 0,
  transitioning: false,
  invoke: vi.fn(),
  accountFetchMe: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/features/auth", () => ({
  accountFetchMe: mocks.accountFetchMe,
}));
vi.mock("@/features/auth", () => ({
  isAccountSessionTransitioning: () => mocks.transitioning,
  readAccountSessionGeneration: () => mocks.generation,
}));

import type { NativeSession } from "@/features/native-session";
import { useNativeSessionStore } from "@/features/native-session";

describe("native session account isolation", () => {
  beforeEach(() => {
    mocks.generation = 0;
    mocks.transitioning = false;
    mocks.invoke.mockReset();
    mocks.accountFetchMe.mockReset();
    useNativeSessionStore.setState({ status: null, systemError: "" });
  });

  it("discards a session snapshot that resolves after an account change", async () => {
    let resolveSystem: ((value: NativeSession) => void) | undefined;
    const system = new Promise<NativeSession>((resolve) => {
      resolveSystem = resolve;
    });
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "check_system") return system;
      throw new Error(`Unexpected command: ${command}`);
    });

    const request = useNativeSessionStore.getState().loadSystem();
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("check_system"));
    mocks.generation += 1;
    resolveSystem?.({ current_user: null, current_license: null });
    await request;

    expect(useNativeSessionStore.getState().status).toBeNull();
  });

  it("publishes the committed native identity", async () => {
    const native: NativeSession = {
      current_user: {
        id: "account-b",
        name: "Account B",
        username: "account-b",
        email: "b@example.test",
      },
      current_license: {
        tier: "pro",
        status: "active",
        allows_use: true,
        expires_at: null,
        trial_started_at: null,
        license_device: "Test Mac",
      },
    };
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "save_authenticated_user") return Promise.resolve(native);
      throw new Error(`Unexpected command: ${command}`);
    });

    await useNativeSessionStore
      .getState()
      .saveAuthenticatedUser(native.current_user!, native.current_license!);

    expect(useNativeSessionStore.getState().status?.current_user?.id).toBe("account-b");
    expect(useNativeSessionStore.getState().status?.current_license?.tier).toBe("pro");
  });
});
