import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { useSpacesStore } from "../list/use_spaces_store";
import { SpaceChatEntry } from "./SpaceChatEntry";
vi.mock("@/features/account", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("./hooks/use_space_chat_access", () => ({
  useSpaceChatAccess: () => ({ isOwner: false, canWriteMessages: true }),
}));
vi.mock("./SpaceChat", () => ({
  SpaceChat: (props: {
    actions?: { id: string; label: string; onSelect?: () => void }[];
    search?: ReactNode;
    searchedText?: string;
  }) => (
    <div>
      {props.actions?.map((action) => (
        <button key={action.id} type="button" onClick={action.onSelect}>
          {action.label}
        </button>
      ))}
      {props.search}
      <output data-testid="searched">{props.searchedText}</output>
    </div>
  ),
}));
vi.mock("./sidebar/use_space_conversations", () => ({
  useSpaceConversations: () => ({ conversations: [], loading: false, upsert: vi.fn() }),
}));
afterEach(cleanup);
const mount = () => {
  useSpacesStore.setState({
    membersBySpace: { test: [] },
    nodesBySpace: { test: [] },
    spaces: [{ id: "test", name: "Test", owner_user_id: "owner" } as never],
  });
  render(
    <MemoryRouter initialEntries={["/spaces/test/social/misty"]}>
      <SpaceChatEntry spaceId="test" spaceName="Test" />
    </MemoryRouter>,
  );
};

it("puts the chat's controls in its own bar: Threads, Members, Pinned and search", () => {
  mount();
  expect(screen.getByRole("button", { name: "Threads" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Members" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Pinned" })).toBeTruthy();
  expect(screen.getByRole("searchbox", { name: "Search messages" })).toBeTruthy();
});

it("searches the chat's messages when Enter is pressed in the search box", () => {
  mount();
  const search = screen.getByRole("searchbox", { name: "Search messages" });
  fireEvent.change(search, { target: { value: "launch plan" } });
  expect(screen.getByTestId("searched").textContent).toBe("");
  fireEvent.keyDown(search, { key: "Enter" });
  expect(screen.getByTestId("searched").textContent).toBe("launch plan");
});
