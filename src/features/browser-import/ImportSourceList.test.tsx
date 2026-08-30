import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ImportSourceList } from "./ImportSourceList";
import type { ImportSource } from "./native";

afterEach(cleanup);

const sources: ImportSource[] = [
  {
    browser: "zen",
    name: "Zen",
    profiles: [{ id: "Profiles/a.default", name: "default", lastUsed: 2 }],
  },
  {
    browser: "chrome",
    name: "Google Chrome",
    profiles: [
      { id: "Profile 1", name: "Work", lastUsed: 1 },
      { id: "Default", name: "Personal", lastUsed: 0 },
    ],
  },
];

it("offers one import button per browser found, starting with its newest profile", () => {
  const onChoose = vi.fn();
  render(<ImportSourceList sources={sources} onChoose={onChoose} onFile={vi.fn()} />);
  const buttons = screen.getAllByRole("button").map((b) => b.textContent);
  expect(buttons).toEqual([
    "Import from Zen",
    "Import from Google Chrome",
    "Import a bookmarks file instead",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Import from Google Chrome" }));
  expect(onChoose).toHaveBeenCalledWith({
    browser: "chrome",
    profile: "Profile 1",
    name: "Google Chrome",
    profileName: "Work",
  });
});

it("still offers a bookmarks file when no browser is found", () => {
  const onFile = vi.fn();
  render(<ImportSourceList sources={[]} onChoose={vi.fn()} onFile={onFile} />);
  fireEvent.click(screen.getByRole("button", { name: "Import a bookmarks file instead" }));
  expect(onFile).toHaveBeenCalled();
});
