import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { browserLibrary, type BrowserHistoryVisit } from "../library/native";
import { HistoryPage } from "./HistoryPage";
import { historySectionRange } from "./historySections";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const actions = {
  navigate: vi.fn(),
  openInNewView: vi.fn(),
  openPage: vi.fn(),
  clearBrowsingData: vi.fn(),
};
const visit = (id: number, visitedAt: number, title = `Page ${id}`): BrowserHistoryVisit => ({
  id,
  visitedAt,
  title,
  url: `https://example.com/${id}`,
});

it("uses local calendar-day boundaries for yesterday and older history", () => {
  const now = new Date(2026, 2, 9, 12);
  expect(historySectionRange("yesterday", now)).toEqual({
    since: new Date(2026, 2, 8).getTime(),
    before: new Date(2026, 2, 9).getTime(),
  });
  expect(historySectionRange("older", now)).toEqual({
    since: undefined,
    before: new Date(2026, 2, 8).getTime(),
  });
});

it("paginates within a section and queries older sections beyond the first recent page", async () => {
  const { since: today } = historySectionRange("today");
  const { since: yesterday } = historySectionRange("yesterday");
  const visits = [
    ...Array.from({ length: 151 }, (_, index) => visit(index, today! + 3_600_000 - index)),
    visit(200, yesterday! + 1, "Yesterday page"),
    visit(300, yesterday! - 1, "Older page"),
  ];
  const query = vi
    .spyOn(browserLibrary, "history")
    .mockImplementation(async (request) =>
      visits
        .filter(
          (item) =>
            item.visitedAt < (request.before ?? Infinity) &&
            item.title.includes(request.text ?? ""),
        )
        .slice(0, request.limit),
    );
  render(<HistoryPage {...actions} />);
  await screen.findByText("Page 0");
  fireEvent.click(screen.getByRole("button", { name: "Today" }));
  await screen.findByText("Page 0");
  fireEvent.click(screen.getByRole("button", { name: "Show older" }));
  await screen.findByText("Page 150");
  expect(screen.queryByText("Yesterday page")).toBeNull();
  expect(screen.queryByRole("button", { name: "Show older" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Page 0" }));
  fireEvent.click(screen.getByRole("button", { name: "Yesterday" }));
  await screen.findByText("Yesterday page");
  expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ before: today }));
  expect(screen.queryByRole("button", { name: "Delete 1 selected" })).toBeNull();
  expect(screen.queryByText("Older page")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Older" }));
  await screen.findByText("Older page");
  expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ before: yesterday }));
  fireEvent.change(screen.getByRole("searchbox", { name: "Search history" }), {
    target: { value: "missing" },
  });
  await screen.findByText("No matching pages");
  expect(query).toHaveBeenLastCalledWith(
    expect.objectContaining({ before: yesterday, text: "missing" }),
  );
});

it("ignores an earlier section response after switching sections", async () => {
  let finishOldRequest!: (visits: BrowserHistoryVisit[]) => void;
  const query = vi
    .spyOn(browserLibrary, "history")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOldRequest = resolve;
        }),
    )
    .mockResolvedValue([visit(1, 1, "Older page")]);
  render(<HistoryPage {...actions} />);
  await waitFor(() => expect(query).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Older" }));
  await screen.findByText("Older page");
  await act(async () => finishOldRequest([visit(2, Date.now(), "Recent page")]));
  expect(screen.getByText("Older page")).toBeTruthy();
  expect(screen.queryByText("Recent page")).toBeNull();
});
