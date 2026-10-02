import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { BookmarkEditor } from "./BookmarkEditor";
import { bookmarks, saveBookmark } from "./library";
beforeEach(() => useWorkspaceStore.getState().reset());
afterEach(cleanup);
it("edits an existing bookmark instead of creating a duplicate", () => {
  const id = saveBookmark({ title: "Before", url: "https://example.com" });
  const onClose = vi.fn();
  render(
    <BookmarkEditor
      bookmark={bookmarks(useWorkspaceStore.getState().bookmarks)[0]}
      onClose={onClose}
    />,
  );
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "After" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(bookmarks(useWorkspaceStore.getState().bookmarks)).toMatchObject([{ id, title: "After" }]);
  expect(onClose).toHaveBeenCalledOnce();
});
it("keeps invalid addresses editable and reports the error", () => {
  const onClose = vi.fn();
  render(<BookmarkEditor title="Invalid" url="javascript:alert(1)" onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  expect(useWorkspaceStore.getState().bookmarks).toEqual([]);
});
