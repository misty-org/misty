import { afterEach, expect, it, vi } from "vitest";
import { showStartupFailure } from "./startupFailure";

afterEach(() => document.body.replaceChildren());

it("offers a focused reload action even when the application cannot mount", () => {
  document.body.innerHTML = '<div id="root"></div>';
  const reload = vi.fn();
  showStartupFailure(reload);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "couldn’t finish loading",
  );
  const button = document.querySelector("button")!;
  expect(document.activeElement).toBe(button);
  button.click();
  expect(reload).toHaveBeenCalledOnce();
});
