import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SyncVaultForm } from "./SyncVaultForm";
afterEach(cleanup);
const secret = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));
const password = "unique account password";
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
function mount(
  props: Partial<Parameters<typeof SyncVaultForm>[0]> = {},
  onUnlock = vi.fn(async () => {}),
) {
  render(<SyncVaultForm create={false} local={false} onUnlock={onUnlock} {...props} />);
  return { onUnlock };
}
describe("sync vault setup and unlock", () => {
  it("sets up with only the Misty password and clears it after success", async () => {
    const h = mount({ create: true });
    expect(screen.queryByLabelText("Sync secret")).toBeNull();
    expect(screen.queryByLabelText("Confirm password")).toBeNull();
    fill("Misty password", password);
    fireEvent.click(screen.getByRole("button", { name: "Turn on sync" }));
    await waitFor(() =>
      expect(h.onUnlock).toHaveBeenCalledWith({ password, syncSecret: null, remember: true }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText("Misty password") as HTMLInputElement).value).toBe(""),
    );
  });
  it("asks a Google account to confirm the password it chooses", async () => {
    const h = mount({ create: true, confirmPassword: true });
    fill("Misty password", password);
    fill("Confirm password", "a different password");
    fireEvent.click(screen.getByRole("button", { name: "Turn on sync" }));
    expect(screen.getByRole("alert").textContent).toContain("do not match");
    expect(h.onUnlock).not.toHaveBeenCalled();
    fill("Confirm password", password);
    fireEvent.click(screen.getByRole("button", { name: "Turn on sync" }));
    await waitFor(() => expect(h.onUnlock).toHaveBeenCalledTimes(1));
  });
  it("sends an account that has only seen its password in plain form to choose a new one", () => {
    const choose = vi.fn();
    const h = mount({ create: true, needsNewPassword: true, onChooseNewPassword: choose });
    expect(screen.queryByLabelText("Misty password")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Choose password…" }));
    expect(choose).toHaveBeenCalledTimes(1);
    expect(h.onUnlock).not.toHaveBeenCalled();
  });
  it("unlocks a vault under the Misty password without asking for a secret", async () => {
    const h = mount({ local: true });
    expect(screen.queryByLabelText("Sync secret")).toBeNull();
    fill("Misty password", password);
    fireEvent.click(screen.getByRole("button", { name: "Unlock sync" }));
    await waitFor(() =>
      expect(h.onUnlock).toHaveBeenCalledWith({ password, syncSecret: null, remember: true }),
    );
  });
  it("still asks for the secret of a vault made before account passwords", async () => {
    const h = mount({ legacy: true });
    fill("Sync password", password);
    fireEvent.click(screen.getByRole("button", { name: "Unlock sync" }));
    expect(screen.getByRole("alert").textContent).toContain("sync secret");
    expect(h.onUnlock).not.toHaveBeenCalled();
    fill("Sync secret", secret);
    fireEvent.click(screen.getByRole("button", { name: "Unlock sync" }));
    await waitFor(() =>
      expect(h.onUnlock).toHaveBeenCalledWith({ password, syncSecret: secret, remember: true }),
    );
  });
  it("can unlock offline using the saved OS key without sending typed values", async () => {
    const h = mount({ local: true });
    fill("Misty password", "unused password");
    fireEvent.click(screen.getByRole("button", { name: "Use saved device key" }));
    await waitFor(() =>
      expect(h.onUnlock).toHaveBeenCalledWith({
        password: null,
        syncSecret: null,
        remember: false,
      }),
    );
  });
  it("shows failures and retains the form for a safe retry", async () => {
    const onUnlock = vi.fn(async () => {});
    onUnlock.mockRejectedValueOnce(new Error("Could not unlock this vault"));
    const h = mount({ local: true }, onUnlock);
    fill("Misty password", password);
    fireEvent.click(screen.getByRole("button", { name: "Unlock sync" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Check it"));
    expect((screen.getByLabelText("Misty password") as HTMLInputElement).value).toBe(password);
    fireEvent.click(screen.getByRole("button", { name: "Unlock sync" }));
    await waitFor(() => expect(h.onUnlock).toHaveBeenCalledTimes(2));
  });
});
