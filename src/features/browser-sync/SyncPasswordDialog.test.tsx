import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AccountApiError } from "@/api/account/api";
import { SyncPasswordDialog } from "./SyncPasswordDialog";
afterEach(cleanup);
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
function mount(google = false, onSubmit = vi.fn(async () => {})) {
  const onOpenChange = vi.fn();
  render(
    <SyncPasswordDialog open onOpenChange={onOpenChange} google={google} onSubmit={onSubmit} />,
  );
  return { onSubmit, onOpenChange };
}
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save password" }));

describe("choosing the sync password", () => {
  it("asks a password account for its current password and the new one twice", async () => {
    const h = mount();
    fill("New password", "a brand new password");
    fill("Confirm new password", "a brand new password");
    save();
    expect(screen.getByRole("alert").textContent).toContain("current password");
    expect(h.onSubmit).not.toHaveBeenCalled();
    fill("Current password", "the old one");
    save();
    await waitFor(() =>
      expect(h.onSubmit).toHaveBeenCalledWith("the old one", "a brand new password"),
    );
    await waitFor(() => expect(h.onOpenChange).toHaveBeenCalledWith(false));
  });

  it("refuses mismatched passwords before anything is sent", () => {
    const h = mount();
    fill("Current password", "the old one");
    fill("New password", "a brand new password");
    fill("Confirm new password", "a different password");
    save();
    expect(screen.getByRole("alert").textContent).toContain("do not match");
    expect(h.onSubmit).not.toHaveBeenCalled();
  });

  it("does not ask a Google account for a current password", async () => {
    const h = mount(true);
    expect(screen.queryByLabelText("Current password")).toBeNull();
    fill("New password", "a brand new password");
    fill("Confirm new password", "a brand new password");
    save();
    await waitFor(() => expect(h.onSubmit).toHaveBeenCalledWith("", "a brand new password"));
  });

  it("shows why it failed and keeps what was typed", async () => {
    const h = mount(false, vi.fn(async () => Promise.reject(new Error("That password is too common."))));
    fill("Current password", "the old one");
    fill("New password", "password1234");
    fill("Confirm new password", "password1234");
    save();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("That password is too common."),
    );
    expect((screen.getByLabelText("New password") as HTMLInputElement).value).toBe("password1234");
    expect(h.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("says plainly when the current password is wrong", async () => {
    const wrong = new AccountApiError("invalid credentials", 401);
    mount(false, vi.fn(async () => Promise.reject(wrong)));
    fill("Current password", "wrong");
    fill("New password", "a brand new password");
    fill("Confirm new password", "a brand new password");
    save();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Your current password is wrong."),
    );
  });
});
