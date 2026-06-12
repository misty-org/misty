import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MistyConversationSidebar } from "./MistyConversationSidebar";

const conversation = {
  id: "conversation-1",
  title: "Rocket sketch",
  createdAt: "2026-08-25T05:00:00Z",
  updatedAt: new Date().toISOString(),
  messages: [],
  remote: true,
};

describe("MistyConversationSidebar", () => {
  afterEach(cleanup);

  it("offers rename and delete from the conversation context menu", () => {
    const onRename = vi.fn();
    const onDelete = vi.fn();
    render(
      <MistyConversationSidebar
        conversations={[conversation]}
        activeConversationId={conversation.id}
        loading={false}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onRename={onRename}
        onDelete={onDelete}
        onManageConnections={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByText("Rocket sketch"), { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByLabelText("Rename Rocket sketch");
    fireEvent.change(input, { target: { value: "Moon mission" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith(conversation.id, "Moon mission");

    fireEvent.contextMenu(screen.getByText("Rocket sketch"), { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("heading", { name: "Delete conversation?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(conversation.id);
  });
});
