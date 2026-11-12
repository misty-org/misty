import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Plus } from "lucide-react";
import { afterEach, expect, it, vi } from "vitest";
import { SectionHeading } from "./SectionHeading";

afterEach(cleanup);

it("draws a plain heading with a quiet count", () => {
  render(<SectionHeading title="Chats" count={4} />);
  expect(screen.getByRole("heading", { name: "Chats 4" })).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it("folds through its title button", () => {
  const onOpenChange = vi.fn();
  render(<SectionHeading title="Channels" open controls="list" onOpenChange={onOpenChange} />);
  const fold = screen.getByRole("button", { name: "Channels" });
  expect(fold.getAttribute("aria-expanded")).toBe("true");
  expect(fold.getAttribute("aria-controls")).toBe("list");
  fireEvent.click(fold);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("offers one action, icon-only or labeled", () => {
  const onSelect = vi.fn();
  const { rerender } = render(
    <SectionHeading title="Pages" action={{ label: "New page", icon: Plus, onSelect }} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "New page" }));
  expect(onSelect).toHaveBeenCalledOnce();
  rerender(
    <SectionHeading title="Pages" action={{ label: "See all", showLabel: true, onSelect }} />,
  );
  expect(screen.getByRole("button", { name: "See all" }).textContent).toBe("See all");
});
