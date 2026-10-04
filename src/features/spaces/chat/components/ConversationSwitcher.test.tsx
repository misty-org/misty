import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ConversationSwitcher } from "./ConversationSwitcher";
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

vi.mock("../sidebar/useSpaceConversations", () => ({
  useSpaceConversations: () => ({ conversations: [], loading: false, error: null }),
}));
vi.mock("../../useSpacePersonalItems", () => ({
  useSpacePersonalItems: () => ({ items: [], ready: true, error: null }),
}));
vi.mock("../sidebar/CreateEditConversationDialog", () => ({
  CreateEditConversationDialog: () => null,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalScrollIntoView) HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

it("keeps the desktop popover and keyboard focus behavior in a narrow window", async () => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  render(
    <MemoryRouter>
      <header style={{ width: 390 }}>
        <ConversationSwitcher spaceId="space" members={[]} canWrite={false} />
      </header>
    </MemoryRouter>,
  );
  const trigger = screen.getByRole("button", { name: "Switch conversation: Everyone" });
  fireEvent.click(trigger);
  const search = await screen.findByPlaceholderText("Find a chat in this Space…");
  expect(search.closest('[data-slot="popover-content"]')).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(search));
  fireEvent.keyDown(search, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
