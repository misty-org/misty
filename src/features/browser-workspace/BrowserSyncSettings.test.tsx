import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "account-1" } as { id: string } | null,
  availability: vi.fn(),
  credentials: vi.fn(),
  unlock: vi.fn(),
  lock: vi.fn(),
  read: vi.fn(),
  generation: 1,
}));
vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: mocks.user, transitioning: false }),
}));
vi.mock("@/api/deployment/api", () => ({
  resolveApiBase: async () => "https://misty.example/v1",
}));
vi.mock("@/api/client/session", () => ({
  isApiSessionTransitioning: () => false,
  readApiSessionGeneration: () => mocks.generation,
  readApiAuthToken: mocks.credentials,
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/shared/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof UiModule>()),
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));
vi.mock("@/features/settings/desktop", () => ({
  DesktopSettingsSection: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
  DesktopSettingsRow: ({ label, children }: { label: string; children: ReactNode }) => (
    <div>
      {label}
      {children}
    </div>
  ),
}));
vi.mock("@/features/settings/SettingsControls", () => ({
  SettingsNote: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  TextControl: ({ value, placeholder }: { value: string; placeholder?: string }) => (
    <input readOnly value={value} placeholder={placeholder} />
  ),
}));
vi.mock("./native", () => ({
  vaultAvailability: mocks.availability,
  generateSyncSecret: vi.fn(),
  unlockNativeSync: mocks.unlock,
  lockNativeSync: mocks.lock,
  readNativeSync: mocks.read,
  activeDeviceEpoch: (session: NativeSyncView) =>
    session.workspace.active_device?.device_id === session.device_id
      ? session.workspace.active_device.epoch
      : null,
}));

import { BrowserSyncSettings } from "./BrowserSyncSettings";
import { useBrowserSyncStore } from "./store";
import type { NativeSyncView } from "./native";
import type * as UiModule from "@/shared/ui";

describe("BrowserSyncSettings", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.resetAllMocks();
    mocks.user = { id: "account-1" };
    mocks.generation = 1;
    mocks.credentials.mockResolvedValue("cookie-session:account-1");
    mocks.availability.mockResolvedValue({ local: true, remote: null });
    mocks.unlock.mockResolvedValue(session());
    useBrowserSyncStore.setState({ session: null, issue: null, connecting: false, reenroll: null });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
  async function mount() {
    await act(async () => root.render(<BrowserSyncSettings />));
  }

  it("uses the restored account without requiring a fetched /me profile", async () => {
    await mount();
    expect(mocks.availability).toHaveBeenCalledWith({
      apiBase: "https://misty.example/v1",
      accountId: "account-1",
    });
    expect(container.textContent).not.toContain("Sign in to Misty");
    expect(container.textContent).toContain("Unlock sync");
  });

  it("waits for native JWT restoration before checking the vault", async () => {
    let restore!: () => void;
    mocks.credentials.mockReturnValue(
      new Promise<void>((resolve) => {
        restore = resolve;
      }),
    );
    await mount();
    expect(mocks.availability).not.toHaveBeenCalled();
    expect(container.querySelector('input[aria-label="Sync password"]')).not.toBeNull();
    await act(async () => restore());
    expect(mocks.availability).toHaveBeenCalledTimes(1);
  });

  it("recovers the settings after a network failure without user intervention", async () => {
    mocks.availability.mockRejectedValueOnce(new Error("Offline"));
    await mount();
    expect(container.textContent).toContain("Offline");
    expect(container.textContent).toContain("Unlock your sync vault");
    expect(container.textContent).not.toContain("Create sync vault");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(container.textContent).not.toContain("Offline");
    expect(container.textContent).toContain("Unlock sync");
  });

  it("keeps the unlock form mounted during background retries", async () => {
    await mount();
    const form = container.querySelector("form");
    await act(async () => useBrowserSyncStore.setState({ connecting: true }));
    expect(form?.isConnected).toBe(true);
  });

  it("keeps entered unlock details across failed checks and manual retries", async () => {
    mocks.availability.mockRejectedValue(new Error("Could not reach the sync server."));
    await mount();
    const form = container.querySelector("form")!;
    const password = container.querySelector<HTMLInputElement>(
      'input[aria-label="Sync password"]',
    )!;
    const secret = container.querySelector<HTMLInputElement>('input[aria-label="Sync secret"]')!;
    await act(async () => {
      fireEvent.change(password, { target: { value: "test sync password" } });
      fireEvent.change(secret, { target: { value: `${"A".repeat(43)}=` } });
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Try again",
    )!;
    await act(async () => fireEvent.click(retry));
    expect(mocks.availability).toHaveBeenCalledTimes(3);
    expect(form.isConnected).toBe(true);
    expect(password.value).toBe("test sync password");
    expect(secret.value).toBe(`${"A".repeat(43)}=`);
    expect(container.textContent).not.toContain("Create sync vault");

    await act(async () => fireEvent.submit(form));
    expect(mocks.unlock).toHaveBeenCalledWith(
      { apiBase: "https://misty.example/v1", accountId: "account-1" },
      "test sync password",
      `${"A".repeat(43)}=`,
      true,
      false,
      false,
    );
    expect(useBrowserSyncStore.getState().session?.account_id).toBe("account-1");
    expect(container.textContent).not.toContain("Could not reach the sync server.");
  });

  it("shows unlock recovery when account credential restoration fails", async () => {
    mocks.credentials.mockRejectedValue(new Error("Sign in again to reconnect sync."));
    await mount();
    expect(container.textContent).toContain("Sign in again to reconnect sync.");
    expect(container.textContent).toContain("Unlock your sync vault");
    expect(container.textContent).not.toContain("Create sync vault");
    expect(mocks.availability).not.toHaveBeenCalled();
  });

  it("only offers vault creation after confirming there is no remote vault", async () => {
    let resolve!: (value: { local: boolean; remote: boolean }) => void;
    mocks.availability.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await mount();
    expect(container.textContent).toContain("Unlock your sync vault");
    expect(container.textContent).not.toContain("Create sync vault");
    await act(async () => resolve({ local: false, remote: false }));
    expect(container.textContent).toContain("Create sync vault");
  });

  it("does not unlock the previous account after credentials finish restoring", async () => {
    await mount();
    let restore!: () => void;
    mocks.credentials.mockReturnValue(
      new Promise<void>((done) => {
        restore = done;
      }),
    );
    const savedKey = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Use saved device key",
    )!;
    await act(async () => fireEvent.click(savedKey));
    expect(mocks.unlock).not.toHaveBeenCalled();
    mocks.generation++;
    await act(async () => restore());
    expect(mocks.unlock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Your account changed. Reopen sync settings.");
  });

  it("clears unlock details when the account changes during a failed check", async () => {
    mocks.availability.mockRejectedValue(new Error("Offline"));
    await mount();
    const password = container.querySelector<HTMLInputElement>(
      'input[aria-label="Sync password"]',
    )!;
    await act(async () => fireEvent.change(password, { target: { value: "test sync password" } }));
    mocks.user = { id: "account-2" };
    mocks.generation++;
    await mount();
    expect(password.isConnected).toBe(false);
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="Sync password"]')?.value,
    ).toBe("");
  });

  it("only requests sign-in when there is no restored account", async () => {
    mocks.user = null;
    await mount();
    expect(container.textContent).toContain("Sign in to Misty");
    expect(mocks.availability).not.toHaveBeenCalled();
  });

  function session(overrides: Partial<NativeSyncView> = {}): NativeSyncView {
    return {
      session_id: "session-1",
      deployment: "https://misty.example/v1",
      account_id: "account-1",
      workspace_id: "workspace-1",
      device_id: "device-1",
      profile_id: "profile-1",
      supports_cookie_handoff: true,
      browser_profile_ready: false,
      status: {
        phase: "ready",
        applied_sequence: 1,
        head_sequence: 1,
        pending_changes: 0,
        issue: null,
      },
      presence: [],
      pending_operation_ids: [],
      workspace: {
        active_device: { device_id: "device-1", epoch: "epoch-1", sequence: 1 },
        version: 1,
        sequence: 1,
        records: [],
        orphaned_tab_ids: [],
        orphaned_website_ids: [],
        resumes: {},
      },
      ...overrides,
    };
  }

  it("shows the device role without an active-device toggle", async () => {
    useBrowserSyncStore.setState({ session: session() });
    await mount();
    expect(container.textContent).toContain("This device");
    expect(container.querySelector('[role="switch"]')).toBeNull();
  });

  it.each(["offline", "connecting"] as const)(
    "shows the connection dependency while %s, not endless preparation or zero devices",
    async (phase) => {
      const current = session();
      current.status.phase = phase;
      useBrowserSyncStore.setState({ session: current });
      await mount();
      expect(container.textContent).not.toContain("Preparing website storage");
      const rows = Array.from(container.querySelectorAll("div"));
      expect(
        rows.find((row) => row.textContent?.startsWith("Other devices online"))?.textContent,
      ).toBe("Other devices onlineWaiting for sync connection");
      expect(rows.find((row) => row.textContent?.startsWith("Website data"))?.textContent).toBe(
        "Website dataWaiting for sync connection",
      );
      await act(async () => {
        useBrowserSyncStore.setState({ session: session({ browser_profile_ready: true }) });
      });
      expect(container.textContent).toContain("Automatic sync enabled");
    },
  );

  it.each([
    ["unsupported", "Not supported on this device"],
    ["error", "Needs attention"],
    ["catching-up", "Waiting for workspace changes"],
    ["pending", "Waiting for changes to finish syncing"],
    ["empty", "Waiting for workspace data"],
    ["preparing", "Preparing website storage"],
  ])("explains website storage state: %s", async (state, expected) => {
    const current = session();
    if (state === "unsupported") current.supports_cookie_handoff = false;
    if (state === "error") current.status.issue = "Browser storage unavailable";
    if (state === "catching-up") current.status.head_sequence = 2;
    if (state === "pending") current.status.pending_changes = 1;
    if (state === "preparing")
      current.workspace.records = [
        { kind: "window", id: "window-1", fields: { title: "Browser", order: 0 } },
      ];
    useBrowserSyncStore.setState({ session: current });
    await mount();
    const row = Array.from(container.querySelectorAll("div")).find((element) =>
      element.textContent?.startsWith("Website data"),
    );
    expect(row?.textContent).toBe(`Website data${expected}`);
  });

  it("keeps healthy workspace sync visible when local website capture fails", async () => {
    useBrowserSyncStore.setState({
      session: session({
        browser_profile_issue:
          "Website storage could not verify this browser profile. Retrying automatically.",
      }),
    });
    await mount();
    const rows = Array.from(container.querySelectorAll("div"));
    expect(rows.find((row) => row.textContent?.startsWith("Workspace status"))?.textContent).toBe(
      "Workspace statusWorkspace changes up to date",
    );
    expect(rows.find((row) => row.textContent?.startsWith("Website data"))?.textContent).toBe(
      "Website dataNeeds attention",
    );
    expect(container.textContent).toContain(
      "Website storage could not verify this browser profile",
    );
    expect(container.textContent).not.toContain("Reconnect");
  });

  it("asks for the vault password to re-register a device the server rejected", async () => {
    const rejected = session();
    rejected.status.phase = "attention";
    rejected.status.issue = "sync_device_forbidden";
    useBrowserSyncStore.setState({ session: rejected });
    await mount();
    const reconnect = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Reconnect",
    )!;
    await act(async () => fireEvent.click(reconnect));
    // The remembered key opens the rejected identity, so it is dropped rather
    // than reused.
    expect(mocks.lock).toHaveBeenCalledWith(rejected.session_id, true);
    expect(mocks.unlock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Reconnect this device");
    expect(container.textContent).not.toContain("Use saved device key");

    // A background retry failing on the dropped key must not hide the form.
    await act(async () =>
      useBrowserSyncStore.setState({ issue: "Could not unlock encrypted sync data" }),
    );
    expect(container.textContent).not.toContain("Could not unlock encrypted sync data");

    const form = container.querySelector("form")!;
    await act(async () => {
      fireEvent.change(container.querySelector('input[aria-label="Sync password"]')!, {
        target: { value: "test sync password" },
      });
      fireEvent.change(container.querySelector('input[aria-label="Sync secret"]')!, {
        target: { value: `${"A".repeat(43)}=` },
      });
    });
    await act(async () => fireEvent.submit(form));
    expect(mocks.unlock).toHaveBeenCalledWith(
      { apiBase: "https://misty.example/v1", accountId: "account-1" },
      "test sync password",
      `${"A".repeat(43)}=`,
      true,
      false,
      true,
    );
    expect(useBrowserSyncStore.getState().reenroll).toBeNull();
    expect(container.textContent).toContain("Workspace changes up to date");
  });

  it("reopens with the saved key for issues a new identity cannot fix", async () => {
    const offline = session();
    offline.status.phase = "attention";
    offline.status.issue = "sync_protocol_failed";
    useBrowserSyncStore.setState({ session: offline });
    await mount();
    const reconnect = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Reconnect",
    )!;
    await act(async () => fireEvent.click(reconnect));
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.unlock).toHaveBeenCalledWith(
      { apiBase: "https://misty.example/v1", accountId: "account-1" },
      null,
      null,
      false,
    );
    expect(useBrowserSyncStore.getState().reenroll).toBeNull();
  });
});
