import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Notification } from "./notification";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("stacks notices outside the content and removes the viewport when all are dismissed", () => {
  const onDismiss = vi.fn();
  const { container } = render(
    <>
      <Notification title="Todoist" onDismiss={onDismiss}>
        Complete sign-in to continue.
      </Notification>
      <Notification title="Saved" tone="success">
        Your changes were saved.
      </Notification>
    </>,
  );
  const viewport = document.getElementById("misty-notification-viewport")!;
  expect(viewport.querySelectorAll("[data-misty-notification]")).toHaveLength(2);
  expect(container.querySelector('[role="status"]')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss Todoist" }));
  expect(onDismiss).toHaveBeenCalledOnce();
  expect(viewport.querySelectorAll("[data-misty-notification]")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss Saved" }));
  expect(document.getElementById("misty-notification-viewport")).toBeNull();
});

it("pauses timed feedback while being read and keeps actionable notices until dismissed", () => {
  vi.useFakeTimers();
  render(
    <>
      <Notification title="Saved" duration={3500}>
        Saved changes.
      </Notification>
      <Notification title="Connection" tone="error">
        <button>Retry</button>
      </Notification>
    </>,
  );
  fireEvent.mouseEnter(screen.getByRole("status"));
  act(() => vi.advanceTimersByTime(10000));
  expect(screen.getByText("Saved changes.")).toBeTruthy();
  fireEvent.mouseLeave(screen.getByRole("status"));
  act(() => vi.advanceTimersByTime(3500));
  expect(screen.queryByText("Saved changes.")).toBeNull();
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
});

it("hides notices from inactive panes and cleans up after unmount", () => {
  const { rerender, unmount } = render(<Notification active={false}>Sign in</Notification>);
  expect(screen.queryByRole("status")).toBeNull();
  rerender(<Notification active>Sign in</Notification>);
  expect(screen.getByRole("status").textContent).toContain("Sign in");
  rerender(<Notification active={false}>Sign in</Notification>);
  expect(document.getElementById("misty-notification-viewport")).toBeNull();
  rerender(<Notification active>Sign in</Notification>);
  unmount();
  expect(document.getElementById("misty-notification-viewport")).toBeNull();
});
