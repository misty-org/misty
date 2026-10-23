import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { useSpacesStore } from "../store/useSpacesStore";
import { SpaceChatEntry } from "./SpaceChatEntry";
vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("./hooks/useSpaceChatAccess", () => ({
  useSpaceChatAccess: () => ({ isOwner: false, canWriteMessages: true }),
}));
vi.mock("./SpaceChat", () => ({ SpaceChat: () => null }));
vi.mock("./sidebar/CreateEditConversationDialog", () => ({
  CreateEditConversationDialog: () => null,
}));
vi.mock("./sidebar/useSpaceConversations", () => ({
  useSpaceConversations: () => ({
    conversations: [
      {
        id: "design",
        title: "Design updates",
        kind: "standard",
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
const mount = (path: string) => {
  useSpacesStore.setState({ membersBySpace: { test: [] }, nodesBySpace: { test: [] }, spaces: [] });
  render(
    <MemoryRouter initialEntries={[path]}>
      <SpaceChatEntry spaceId="test" spaceName="Test" />
      <Route />
    </MemoryRouter>,
  );
};

it("lists channels in the sidebar and opens the conversation", () => {
  mount("/spaces/test/social/misty");
  fireEvent.click(screen.getByRole("button", { name: "Design updates" }));
  expect(screen.getByTestId("route").textContent).toBe(
    "/spaces/test/social/misty?conversation=design",
  );
});

it("returns to the Space-wide channel from a conversation", () => {
  mount("/spaces/test/social/misty?conversation=design");
  fireEvent.click(screen.getByRole("button", { name: "everyone" }));
  expect(screen.getByTestId("route").textContent).toBe("/spaces/test/social/misty");
});
