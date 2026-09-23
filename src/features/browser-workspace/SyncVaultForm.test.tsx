import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SyncVaultForm } from "./SyncVaultForm";
afterEach(cleanup);
const secret = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));
const password = "unique sync password";
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
function mount(create = true) {
  const onUnlock = vi.fn(async () => {});
  const onGenerateSecret = vi.fn(async () => secret);
  render(
    <SyncVaultForm
      create={create}
      local={!create}
      onUnlock={onUnlock}
      onGenerateSecret={onGenerateSecret}
    />,
  );
  return { onUnlock, onGenerateSecret };
}
describe("sync vault setup and unlock", () => {
  it("uses the native base64 secret, requires saved confirmation, and clears secrets after success", async () => {
    const h = mount();
    expect(
      (screen.getByRole("button", { name: "Create sync vault" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Generate secret" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Sync secret") as HTMLInputElement).value).toBe(secret),
    );
    fill("Sync password", password);
    fill("Confirm sync password", password);
    fireEvent.click(screen.getByLabelText("I saved my sync secret"));
    fireEvent.click(screen.getByRole("button", { name: "Create sync vault" }));
    await waitFor(() =>
      expect(h.onUnlock).toHaveBeenCalledWith({ password, syncSecret: secret, remember: true }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText("Sync password") as HTMLInputElement).value).toBe(""),
    );
    expect((screen.getByLabelText("Sync secret") as HTMLInputElement).value).toBe("");
  });
  it("rejects mismatched passwords before invoking native", async () => {
    const h = mount();
    fireEvent.click(screen.getByRole("button", { name: "Generate secret" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Sync secret") as HTMLInputElement).value).toBe(secret),
    );
    fill("Sync password", password);
    fill("Confirm sync password", "a different password");
    fireEvent.click(screen.getByLabelText("I saved my sync secret"));
    fireEvent.click(screen.getByRole("button", { name: "Create sync vault" }));
    expect(screen.getByRole("alert").textContent).toContain("do not match");
    expect(h.onUnlock).not.toHaveBeenCalled();
  });
  it("can unlock offline using the saved OS key without sending typed secrets", async () => {
    const h = mount(false);
    fill("Sync password", "unused password");
    fill("Sync secret", "unused secret");
    fireEvent.click(screen.getByRole("button", { name: "Use saved device key" }));
    await waitFor(() =>
      expect(h.onUnlock).toHaveBeenCalledWith({
        password: null,
        syncSecret: null,
        remember: false,
      }),
    );
  });
  it("shows native failures and retains the form for a safe retry", async () => {
    const h = mount(false);
    h.onUnlock.mockRejectedValueOnce(new Error("Could not unlock this vault"));
    fill("Sync password", password);
    fill("Sync secret", secret);
    fireEvent.click(screen.getByRole("button", { name: "Unlock sync" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Could not unlock"),
    );
    expect((screen.getByLabelText("Sync password") as HTMLInputElement).value).toBe(password);
    expect(h.onUnlock).toHaveBeenCalledWith({ password, syncSecret: secret, remember: true });
    fireEvent.click(screen.getByRole("button", { name: "Unlock sync" }));
    await waitFor(() => expect(h.onUnlock).toHaveBeenCalledTimes(2));
  });
});
