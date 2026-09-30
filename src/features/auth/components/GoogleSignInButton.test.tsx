import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  available: vi.fn(),
  signIn: vi.fn(),
  authenticate: vi.fn(),
  open: vi.fn(),
  native: true,
}));
vi.mock("@/api/account/api", () => ({ accountApi: { googleAvailable: mocks.available } }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => mocks.native }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.open }));
vi.mock("../AuthContext", () => ({ useAuth: () => ({ authenticateAccount: mocks.authenticate }) }));
vi.mock("../store/useAccountStore", () => ({
  accountGoogleSignIn: mocks.signIn,
  accountGoogleReauthenticate: vi.fn(),
}));
import GoogleSignInButton from "./GoogleSignInButton";

describe("Google sign-in entry", () => {
  let container: HTMLDivElement;
  let root: Root;
  const busy = vi.fn(),
    success = vi.fn(),
    error = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.native = true;
    mocks.available.mockResolvedValue({ enabled: true });
    mocks.open.mockResolvedValue(undefined);
    mocks.authenticate.mockImplementation((operation: () => Promise<unknown>) => operation());
    mocks.signIn.mockImplementation(async (launch: (url: string) => Promise<void>) => {
      await launch("https://api.example/v1/auth/google/start?state=state");
      return { id: "google" };
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });
  async function render() {
    await act(async () =>
      root.render(
        <GoogleSignInButton disabled={false} onBusy={busy} onSuccess={success} onError={error} />,
      ),
    );
  }
  it("opens the system browser and uses the normal account session transition", async () => {
    await render();
    const button = container.querySelector("button")!;
    expect(button.type).toBe("button");
    await act(async () => button.click());
    expect(mocks.open).toHaveBeenCalledWith("https://api.example/v1/auth/google/start?state=state");
    expect(mocks.authenticate).toHaveBeenCalledOnce();
    expect(success).toHaveBeenCalledOnce();
    expect(busy.mock.calls.map(([value]) => value)).toEqual([true, false]);
  });
  it("hides Google when the server has no credentials", async () => {
    mocks.available.mockResolvedValue({ enabled: false });
    await render();
    expect(container.querySelector("button")).toBeNull();
  });
  it("reports a blocked popup without starting a login", async () => {
    mocks.native = false;
    vi.spyOn(window, "open").mockReturnValue(null);
    await render();
    await act(async () => container.querySelector("button")!.click());
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("Allow popups to sign in with Google.");
  });
  it("cancels an outstanding browser sign-in", async () => {
    mocks.signIn.mockImplementation(
      (_launch: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
        ),
    );
    await render();
    await act(async () => container.querySelector("button")!.click());
    const cancel = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Cancel"),
    )!;
    await act(async () => cancel.click());
    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("Google sign-in cancelled.");
  });
});
