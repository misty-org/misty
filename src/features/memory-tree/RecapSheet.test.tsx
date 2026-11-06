import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  children: vi.fn(),
  events: vi.fn(),
  daySummary: vi.fn(),
  search: vi.fn(),
  open: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/features/recall", () => ({
  localDay: (at: string) => at.slice(0, 10),
  recallSettings: () => ({ enabled: true }),
  memoryApi: { events: fixture.events, daySummary: fixture.daySummary },
}));
vi.mock("@/features/settings", () => ({
  useSettingsStore: (select: (state: unknown) => unknown) => select({ settings: { document: {} } }),
}));
vi.mock("@/features/workspace", () => ({
  useWorkspaceStore: { getState: () => ({ openBrowserView: fixture.open }) },
}));
vi.mock("./api", () => ({ treeApi: { children: fixture.children } }));
vi.mock("./useMemoryTreeStore", () => ({
  useMemoryTreeStore: Object.assign(
    (select: (state: unknown) => unknown) => select({ search: fixture.search }),
    { getState: () => ({ refresh: fixture.refresh }) },
  ),
}));

import { RecapSheet } from "./RecapSheet";

const page = {
  id: "e1",
  occurred_at: "2026-11-05T10:00:00",
  url: "https://github.com/pull/1",
  title: "Pull request",
  site: "github.com",
};
const recap = {
  id: "summary:recap-2026-11-05",
  text: "You traced the sync bug.",
  outline: {
    threads: [{ title: "Traced the sync bug", from: "10:00", to: "11:00" }],
    next: ["Reply on the issue"],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  fixture.children.mockResolvedValue([recap]);
  fixture.events.mockImplementation(async (query: { from?: string; to?: string }) => {
    if (query.from && !query.to) return { events: [] };
    if (query.to && !query.from) return { events: [] };
    return { events: [page] };
  });
});
afterEach(cleanup);

it("reads a day: its text, where you left off, what you did and what's next", async () => {
  render(<RecapSheet spaceId="space" startDay={null} onClose={() => undefined} />);
  await screen.findByText("You traced the sync bug.");
  expect(screen.getByText("Where you left off")).toBeTruthy();
  expect(screen.getByText("What you did")).toBeTruthy();
  expect(screen.getByText("Reply on the issue")).toBeTruthy();
  // Recaps write themselves, and nothing here starts reading the screen.
  expect(screen.queryByRole("button", { name: /Update|Write|Read screen/ })).toBeNull();
  // No other day has moments.
  expect(screen.getByRole("button", { name: "Previous day" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Next day" }).hasAttribute("disabled")).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(fixture.open).toHaveBeenCalledWith({ url: page.url });
  fireEvent.click(screen.getByRole("button", { name: /Traced the sync bug/ }));
  expect(fixture.search).toHaveBeenCalledWith("Traced the sync bug");
});

it("lists the day's sites until its recap has been written", async () => {
  fixture.children.mockResolvedValue([]);
  render(<RecapSheet spaceId="space" startDay="2026-11-05" onClose={() => undefined} />);
  await screen.findByText("Sites you read");
  expect(screen.getByRole("button", { name: /github\.com/ })).toBeTruthy();
  expect(screen.queryByText("Next")).toBeNull();
  expect(fixture.daySummary).not.toHaveBeenCalled();
});

it("says so when nothing has been remembered", async () => {
  fixture.events.mockResolvedValue({ events: [] });
  render(<RecapSheet spaceId="space" startDay={null} onClose={() => undefined} />);
  await waitFor(() => expect(screen.getByText("Nothing to recap yet.")).toBeTruthy());
});
