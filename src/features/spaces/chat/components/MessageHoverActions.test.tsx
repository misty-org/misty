import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MessageHoverActions } from "./MessageHoverActions";
import type { SpaceMessage } from "@/api/spaces/dto/interfaces/types";
afterEach(cleanup);
const message = {
  id: "m",
  sender_user_id: "author",
  sender_kind: "person",
  content: [{ type: "text", text: "A message" }],
  reactions: [],
} as unknown as SpaceMessage;
function mount(currentUserId: string, isOwner = false, canWrite = true) {
  return render(
    <MessageHoverActions
      message={message}
      currentUserId={currentUserId}
      isOwner={isOwner}
      canWrite={canWrite}
      onReply={vi.fn()}
      onToggleReaction={vi.fn()}
      onBeginEditing={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
}
function open() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "More message actions" }), {
    button: 0,
    ctrlKey: false,
  });
}
it("only offers edit to the author, and delete to the author or owner", () => {
  const ui = mount("author");
  open();
  expect(screen.getByRole("menuitem", { name: "Edit" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
  ui.unmount();
  const owner = mount("owner", true);
  open();
  expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
  expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
  owner.unmount();
  mount("reader");
  open();
  expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  expect(screen.getByRole("menuitem", { name: "Copy text" })).toBeTruthy();
});
it("keeps only copy available in read-only chat", () => {
  mount("author", true, false);
  expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
  open();
  expect(screen.getAllByRole("menuitem")).toHaveLength(1);
});
