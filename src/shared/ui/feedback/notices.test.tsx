import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NoticeViewport, notify, resetNotices, useNotice } from "./notices";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  act(() => resetNotices());
  vi.useRealTimers();
});

const shown = () =>
  Array.from(document.querySelectorAll("[data-slot='notice']")).map((notice) => notice.textContent);

it("shows at most three, newest last, and drops the oldest timed one", () => {
  render(<NoticeViewport />);
  act(() => {
    for (const message of ["One", "Two", "Three", "Four"]) notify({ message });
  });
  expect(shown()).toEqual(["Two", "Three", "Four"]);
});

it("leaves on its own after five seconds, paused while hovered", () => {
  render(<NoticeViewport />);
  act(() => void notify({ message: "Chat archived" }));
  const viewport = document.querySelector("[data-slot='notice-viewport']")!;
  act(() => vi.advanceTimersByTime(4000));
  fireEvent.pointerEnter(viewport);
  act(() => vi.advanceTimersByTime(20000));
  expect(screen.getByText("Chat archived")).toBeTruthy();
  fireEvent.pointerLeave(viewport);
  act(() => vi.advanceTimersByTime(999));
  expect(screen.getByText("Chat archived")).toBeTruthy();
  act(() => vi.advanceTimersByTime(2));
  expect(screen.queryByText("Chat archived")).toBeNull();
});

it("runs its one action and leaves", () => {
  const undo = vi.fn();
  const onDismiss = vi.fn();
  render(<NoticeViewport />);
  act(
    () =>
      void notify({
        message: "Chat archived",
        action: { label: "Undo", onSelect: undo },
        onDismiss,
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(undo).toHaveBeenCalledOnce();
  expect(onDismiss).toHaveBeenCalledOnce();
  expect(screen.queryByText("Chat archived")).toBeNull();
});

it("replaces a notice under the same id and marks errors as alerts", () => {
  render(<NoticeViewport />);
  act(() => void notify({ id: "sync", message: "Sync failed", tone: "error" }));
  act(() => void notify({ id: "sync", message: "Sync failed again", tone: "error" }));
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(screen.getByRole("alert").textContent).toContain("Sync failed again");
});

it("can be dismissed through its handle", () => {
  render(<NoticeViewport />);
  let handle: ReturnType<typeof notify> | undefined;
  act(() => void (handle = notify({ message: "Copied link" })));
  act(() => handle?.dismiss());
  expect(screen.queryByText("Copied link")).toBeNull();
});

function SignInNotice({ needed }: { needed: boolean }) {
  useNotice(needed, { message: "Sign in to Todoist to continue" });
  return null;
}

it("keeps a held notice while its condition holds", () => {
  const { rerender } = render(
    <>
      <NoticeViewport />
      <SignInNotice needed />
    </>,
  );
  act(() => vi.advanceTimersByTime(60000));
  expect(screen.getByText("Sign in to Todoist to continue")).toBeTruthy();
  rerender(
    <>
      <NoticeViewport />
      <SignInNotice needed={false} />
    </>,
  );
  expect(screen.queryByText("Sign in to Todoist to continue")).toBeNull();
});
