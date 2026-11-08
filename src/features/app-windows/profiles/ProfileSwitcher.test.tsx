import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileEntry } from "@/features/app-windows/profiles/profileWindow";

const invoke = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { useProfileWindowStore } from "@/features/app-windows/profiles/profileWindow";
import { ProfileSwitcher, splitProfiles } from "./ProfileSwitcher";

const entry = (id: string, name = id): ProfileEntry => ({ id, name, order: 0 }) as ProfileEntry;
const seed = (profiles: ProfileEntry[], current = profiles[0], incognito = false) =>
  useProfileWindowStore.setState({ profiles, profile: current, incognito });

describe("ProfileSwitcher", () => {
  beforeEach(() => invoke.mockClear());
  afterEach(cleanup);

  it("is hidden with one profile, and in incognito", () => {
    seed([entry("personal", "Personal")]);
    const { container, rerender } = render(<ProfileSwitcher />);
    expect(container.firstChild).toBeNull();
    const two = [entry("personal", "Personal"), entry("work", "Work")];
    seed(two, two[0], true);
    rerender(<ProfileSwitcher />);
    expect(container.firstChild).toBeNull();
  });

  it("marks this window's profile and opens another's window", async () => {
    const two = [entry("personal", "Personal"), entry("work", "Work")];
    seed(two);
    render(<ProfileSwitcher />);
    expect(screen.getByRole("button", { name: "Personal" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Personal" }));
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("profile_open", { id: "work" }));
  });

  it("shows a letter from the name", () => {
    const two = [entry("personal", "personal"), entry("work", "  work")];
    seed(two);
    render(<ProfileSwitcher />);
    expect(screen.getByRole("button", { name: "personal" }).textContent).toBe("P");
    expect(screen.getByRole("button", { name: "work" }).textContent).toBe("W");
  });
});

describe("splitProfiles", () => {
  const six = ["a", "b", "c", "d", "e", "f"].map((id) => entry(id));

  it("shows up to five with nothing extra", () => {
    const five = six.slice(0, 5);
    expect(splitProfiles(five, "a")).toEqual({ shown: five, more: [] });
  });

  it("moves the rest behind a button past five", () => {
    const { shown, more } = splitProfiles(six, "a");
    expect(shown.map((profile) => profile.id)).toEqual(["a", "b", "c", "d"]);
    expect(more.map((profile) => profile.id)).toEqual(["e", "f"]);
  });

  it("always keeps this window's profile visible", () => {
    const { shown, more } = splitProfiles(six, "f");
    expect(shown.map((profile) => profile.id)).toEqual(["a", "b", "c", "f"]);
    expect(more.map((profile) => profile.id)).toEqual(["d", "e"]);
  });
});
