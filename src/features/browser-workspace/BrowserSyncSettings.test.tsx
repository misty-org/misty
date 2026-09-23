import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "account-1" } as { id: string } | null,
  availability: vi.fn(),
  credentials: vi.fn(),
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
vi.mock("@/shared/ui", () => ({
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
vi.mock("@/features/settings/settingsControls", () => ({
  SettingsNote: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
vi.mock("./native", () => ({
  vaultAvailability: mocks.availability,
  generateSyncSecret: vi.fn(),
  unlockNativeSync: vi.fn(),
}));
vi.mock("./SyncVaultForm", () => ({ SyncVaultForm: () => <div>Unlock sync</div> }));

import { BrowserSyncSettings } from "./BrowserSyncSettings";
import { useBrowserSyncStore } from "./store";
import type { NativeSyncView } from "./native";

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
    useBrowserSyncStore.setState({ session: null, issue: null, connecting: false });
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
    await act(async () => restore());
    expect(mocks.availability).toHaveBeenCalledTimes(1);
  });

  it("recovers the settings after a network failure without user intervention", async () => {
    mocks.availability.mockRejectedValueOnce(new Error("Offline"));
    await mount();
    expect(container.textContent).toContain("Offline");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(container.textContent).not.toContain("Offline");
    expect(container.textContent).toContain("Unlock sync");
  });

  it("keeps the unlock form mounted during background retries", async () => {
    await mount();
    const form = Array.from(container.querySelectorAll("div")).find(
      (element) => element.textContent === "Unlock sync",
    );
    await act(async () => useBrowserSyncStore.setState({ connecting: true }));
    expect(form?.isConnected).toBe(true);
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
});
