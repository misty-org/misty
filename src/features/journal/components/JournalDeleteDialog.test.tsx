import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JournalDeleteDialog } from "./JournalDeleteDialog";

describe("JournalDeleteDialog", () => {
  afterEach(cleanup);

  it("does not delete when the user cancels", () => {
    const onConfirm = vi.fn(async () => undefined);
    const onOpenChange = vi.fn();

    render(
      <JournalDeleteDialog
        kind="drawing"
        title="Launch map"
        open
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    );

    expect(
      screen.getByText("“Launch map” will be permanently deleted. This cannot be undone."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("waits for deletion to finish before closing", async () => {
    const onConfirm = vi.fn(async () => undefined);
    const onOpenChange = vi.fn();

    render(
      <JournalDeleteDialog
        kind="note"
        title="Research"
        open
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("keeps the dialog open and explains a failed deletion", async () => {
    const onOpenChange = vi.fn();

    render(
      <JournalDeleteDialog
        kind="drawing"
        title="System map"
        open
        onOpenChange={onOpenChange}
        onConfirm={async () => {
          throw new Error("The drawing is temporarily unavailable.");
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "The drawing is temporarily unavailable.",
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
