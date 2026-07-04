import { render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createInlineRewrite } from "./createInlineRewrite";
it("opens Misty once and closes the compatibility mount without applying an independent rewrite", async () => {
  const openMisty = vi.fn(async () => {}),
    onClose = vi.fn(),
    onApply = vi.fn();
  const Handoff = createInlineRewrite({ openMisty, report: vi.fn() });
  const props = {
    open: true,
    selection: "code",
    language: "typescript",
    filename: "file.ts",
    onClose,
    onApply,
    onOpenSettings: vi.fn(),
  };
  const view = render(<Handoff {...props} />);
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  view.rerender(<Handoff {...props} />);
  expect(openMisty).toHaveBeenCalledOnce();
  expect(onApply).not.toHaveBeenCalled();
  expect(view.container.textContent).toBe("");
});
