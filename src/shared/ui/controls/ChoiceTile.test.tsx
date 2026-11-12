import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChoiceTile } from "./ChoiceTile";

afterEach(cleanup);

it("picks its choice and marks the one picked", () => {
  const onSelect = vi.fn();
  render(
    <>
      <ChoiceTile label="Sun" caption="Sun" selected onSelect={() => {}}>
        <span>☀️</span>
      </ChoiceTile>
      <ChoiceTile label="Moon" caption="Moon" selected={false} onSelect={onSelect} look="outline">
        <span>🌙</span>
      </ChoiceTile>
    </>,
  );
  expect(screen.getByRole("button", { name: "Sun" }).getAttribute("aria-pressed")).toBe("true");
  const moon = screen.getByRole("button", { name: "Moon" });
  expect(moon.getAttribute("aria-pressed")).toBe("false");
  expect(moon.dataset.look).toBe("outline");
  fireEvent.click(moon);
  expect(onSelect).toHaveBeenCalledOnce();
});
