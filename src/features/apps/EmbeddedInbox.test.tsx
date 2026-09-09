import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import EmbeddedInbox from "./EmbeddedInbox";
import { openExternalLink } from "@/shared/platform/openExternalLink";

vi.mock("@/shared/platform/openExternalLink", () => ({ openExternalLink: vi.fn(async () => {}) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("opens provider websites without offering a native mailbox", async () => {
  const ui = render(<EmbeddedInbox />);
  expect(ui.getAllByRole("button")).toHaveLength(4);
  expect(ui.queryByText("Compose")).toBeNull();
  fireEvent.click(ui.getByRole("button", { name: "Open Gmail in browser" }));
  expect(openExternalLink).toHaveBeenCalledWith("https://mail.google.com/mail/u/0/#inbox");
  vi.mocked(openExternalLink).mockRejectedValueOnce(new Error("unavailable"));
  fireEvent.click(ui.getByRole("button", { name: "Open Outlook in browser" }));
  expect((await ui.findByRole("alert")).textContent).toContain("The website could not be opened.");
});
