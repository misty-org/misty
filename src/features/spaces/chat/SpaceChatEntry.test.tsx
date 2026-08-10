import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { useSpacesStore } from "../store/useSpacesStore";
import { ChatCollection } from "./SpaceChatEntry";
vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("./SpaceChat", () => ({ SpaceSocial: () => null }));
vi.mock("./sidebar/CreateEditConversationDialog", () => ({
  CreateEditConversationDialog: () => null,
}));
vi.mock("./sidebar/useSpaceConversations", () => ({
  useSpaceConversations: () => ({
    conversations: [
      {
        id: "connected",
        title: "Design updates",
        kind: "channel",
        origin: "discord",
        participants: [],
        updated_at: "2026-09-30",
        created_by_user_id: "owner",
      },
    ],
    loading: false,
    upsert: vi.fn(),
  }),
}));
function Route() {
  const l = useLocation();
  return (
    <output data-testid="route">
      {l.pathname}
      {l.search}
    </output>
  );
}
afterEach(cleanup);
it("filters connected chats and opens the provider conversation", () => {
  useSpacesStore.setState({ membersBySpace: { test: [] }, spaces: [] });
  render(
    <MemoryRouter initialEntries={["/spaces/test/social"]}>
      <ChatCollection spaceId="test" />
      <Route />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Connected" }));
  expect(screen.queryByRole("button", { name: "Everyone" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Design updates" }));
  expect(screen.getByTestId("route").textContent).toBe(
    "/spaces/test/social/discord?conversation=connected",
  );
});

it("filters chats by creator independently of section tabs and clears the filter", () => {
  useSpacesStore.setState({ membersBySpace: { test: [] }, spaces: [] });
  render(
    <MemoryRouter>
      <ChatCollection spaceId="test" />
    </MemoryRouter>,
  );
  const open = () =>
    fireEvent.pointerDown(screen.getByRole("button", { name: "Filter chats" }), {
      button: 0,
      ctrlKey: false,
    });
  open();
  expect(screen.queryByRole("menuitemradio", { name: "Connected" })).toBeNull();
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Me" }));
  expect(screen.queryByRole("button", { name: "Everyone" })).toBeNull();
  expect(screen.getByRole("button", { name: "Design updates" })).toBeTruthy();
  open();
  fireEvent.click(screen.getByRole("menuitem", { name: "Reset filters" }));
  expect(screen.getByRole("button", { name: "Everyone" })).toBeTruthy();
});
