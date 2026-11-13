import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EmptyState, ErrorState } from "./StateView";

afterEach(cleanup);

it("draws a title, one line and one button", () => {
  const onClick = vi.fn();
  render(
    <EmptyState
      title="No notes yet"
      line="Notes you write here are shared with the Space."
      action={{ label: "New note", onClick }}
    />,
  );
  expect(screen.getByRole("heading", { name: "No notes yet" })).toBeTruthy();
  expect(screen.getByText("Notes you write here are shared with the Space.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "New note" }));
  expect(onClick).toHaveBeenCalledOnce();
});

it("announces an error state", () => {
  render(<ErrorState title="Notes couldn't load" line="Check your connection and try again." />);
  expect(screen.getByRole("alert").textContent).toContain("Notes couldn't load");
});

it("sits in the flow when inline, with a primary button by default", () => {
  const { container } = render(
    <EmptyState
      inline
      title="No approvals"
      line="They show here."
      action={{ label: "Add", onClick: () => {} }}
    />,
  );
  const state = container.querySelector("[data-slot=empty-state]")!;
  expect(state.getAttribute("data-inline")).toBe("true");
  expect(state.className).not.toContain("size-full");
  expect(screen.getByRole("button", { name: "Add" }).getAttribute("data-variant")).toBe("primary");
});

it("draws a title alone when the title says it all", () => {
  const { container } = render(<EmptyState title="Nothing on the calendar this month" />);
  expect(screen.getByRole("heading", { name: "Nothing on the calendar this month" })).toBeTruthy();
  expect(container.querySelector("p")).toBeNull();
});
