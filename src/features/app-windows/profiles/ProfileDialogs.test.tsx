import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  firstProfileId,
  useProfileWindowStore,
  type ProfileEntry,
} from "@/features/app-windows/profiles/profileWindow";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/shared/ui";
import { ProfileDialogs } from "./ProfileDialogs";
import { useProfileDialogs } from "./profileDialogStore";
import { ProfileMenuItems } from "./ProfileMenuItems";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/features/browser/webviews/browserRuntime", () => ({
  setBrowserWebviewsSuspended: vi.fn(),
}));
vi.mock("@/features/app-windows/page-runtime/browserOverlayRuntime", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setBrowserWebviewsSuspended: vi.fn(),
}));
vi.mock("@/features/shortcuts", () => ({ useShortcutHandler: vi.fn() }));

const first: ProfileEntry = { id: firstProfileId, name: "Personal", order: 0, sites: [] };
const work: ProfileEntry = { id: "work", name: "Work", order: 1, sites: [] };

function renderMenu() {
  return render(
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger>Account</DropdownMenuTrigger>
      <DropdownMenuContent>
        <ProfileMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
}

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  useProfileWindowStore.setState({ profile: first, profiles: [first] });
  useProfileDialogs.setState({ open: null });
});
afterEach(cleanup);

describe("the profiles in the account menu", () => {
  it("hides the list until a second profile exists, but always offers to add one", () => {
    renderMenu();
    expect(screen.queryByRole("menuitemcheckbox")).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Add profile…/ })).toBeTruthy();
  });

  it("checks this window's profile and opens another's window without touching this one", () => {
    useProfileWindowStore.setState({ profiles: [first, work] });
    renderMenu();
    const items = screen.getAllByRole("menuitemcheckbox");
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    fireEvent.click(items[0]);
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.click(items[1]);
    expect(mocks.invoke).toHaveBeenCalledWith("profile_open", { id: "work" });
  });
});

describe("the profile dialogs", () => {
  it("names a new profile, which opens in its own window", async () => {
    mocks.invoke.mockResolvedValue({ id: "new", name: "School", order: 2 });
    render(<ProfileDialogs />);
    act(() => useProfileDialogs.getState().show("create"));
    const add = screen.getByRole("button", { name: "Add profile" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: " School " } });
    fireEvent.click(add);
    await waitFor(() => expect(useProfileDialogs.getState().open).toBeNull());
    expect(mocks.invoke).toHaveBeenCalledWith("profile_create", { name: "School", color: null });
  });

  it("shows why a profile couldn't be added and stays open", async () => {
    mocks.invoke.mockRejectedValue("Use a name of 1 to 60 characters.");
    render(<ProfileDialogs />);
    act(() => useProfileDialogs.getState().show("create"));
    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Add profile" }));
    expect(await screen.findByRole("alert", { hidden: true })).toBeTruthy();
    expect(screen.getByRole("alert", { hidden: true }).textContent).toBe(
      "Use a name of 1 to 60 characters.",
    );
    expect(useProfileDialogs.getState().open).toBe("create");
  });

  it("renames this window's profile", async () => {
    useProfileWindowStore.setState({ profile: work, profiles: [first, work] });
    mocks.invoke.mockResolvedValue({ id: "work", name: "Job", order: 1 });
    render(<ProfileDialogs />);
    act(() => useProfileDialogs.getState().show("rename"));
    const name = screen.getByLabelText("Profile name") as HTMLInputElement;
    expect(name.value).toBe("Work");
    fireEvent.change(name, { target: { value: "Job" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(useProfileDialogs.getState().open).toBeNull());
    expect(mocks.invoke).toHaveBeenCalledWith("profile_rename", { id: "work", name: "Job" });
    expect(useProfileWindowStore.getState().profile.name).toBe("Job");
  });

  it("says deleting removes the profile from every computer, and asks first", async () => {
    useProfileWindowStore.setState({ profile: work, profiles: [first, work] });
    render(<ProfileDialogs />);
    act(() => useProfileDialogs.getState().show("delete"));
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "This removes it from every computer",
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete profile" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("profile_delete", { id: "work" }),
    );
  });

  it("never opens deletion for the first profile", () => {
    render(<ProfileDialogs />);
    act(() => useProfileDialogs.getState().show("delete"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
