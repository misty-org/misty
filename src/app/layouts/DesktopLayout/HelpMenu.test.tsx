import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HelpMenu } from "./HelpMenu";
vi.mock("@/features/support", () => ({
  SupportRecoverySection: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>Start tour</button>
  ),
}));
afterEach(cleanup);
it("opens Help independently, closes for the tour, and returns focus to its trigger", async () => {
  render(<HelpMenu className="" />);
  const trigger = screen.getByRole("button", { name: "Help" });
  fireEvent.click(trigger);
  expect(screen.getByRole("dialog", { name: "Help" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Start tour" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
