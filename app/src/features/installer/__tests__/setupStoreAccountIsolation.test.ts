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

import type { NativeSystemInfo } from "@/features/installer";
import { useSetupStore } from "@/features/installer";

const nativeBase = {
  os: "macos",
  arch: "aarch64",
  misty_home: "/tmp/misty",
  install_dir: "/tmp/misty/install",
  legacy_install_dir: "/tmp/misty/legacy",
  db_path: "/tmp/misty/misty.db",
  setup_path: "/Applications/Misty.app",
  installed_version: "0.1.0",
} as const;

describe("setup store account isolation", () => {
  beforeEach(() => {
    mocks.generation = 0;
    mocks.transitioning = false;
    mocks.invoke.mockReset();
    mocks.accountFetchMe.mockReset();
    useSetupStore.setState({ status: null, systemError: "", events: [] });
  });

  it("discards an installer snapshot that resolves after an account change", async () => {
    let resolveSystem: ((value: NativeSystemInfo) => void) | undefined;
    const system = new Promise<NativeSystemInfo>((resolve) => {
      resolveSystem = resolve;
    });
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "check_system") return system;
      if (command === "misty_template_status") return Promise.resolve({ ready: true, entries: [] });
      if (command === "probe_paths") return Promise.resolve([]);
      throw new Error(`Unexpected command: ${command}`);
    });

    const request = useSetupStore.getState().loadSystem();
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("check_system"));
    mocks.generation += 1;
    resolveSystem?.({ ...nativeBase, current_user: null, current_license: null });
    await request;

    expect(useSetupStore.getState().status).toBeNull();
  });

  it("publishes the committed native identity when secondary installer checks fail", async () => {
    const native: NativeSystemInfo = {
      ...nativeBase,
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
      if (command === "misty_template_status")
        return Promise.reject(new Error("template status unavailable"));
      throw new Error(`Unexpected command: ${command}`);
    });

    await useSetupStore
      .getState()
      .saveAuthenticatedUser(native.current_user!, native.current_license!);

    expect(useSetupStore.getState().status?.current_user?.id).toBe("account-b");
    expect(useSetupStore.getState().status?.current_license?.tier).toBe("pro");
    expect(useSetupStore.getState().systemError).toContain("template status unavailable");
  });
});
