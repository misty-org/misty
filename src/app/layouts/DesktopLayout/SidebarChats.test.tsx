import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentProfile } from "@/shared/schemas";
import type { SidebarChat } from "./SidebarChats";

const removed = vi.hoisted(() => ({ ids: [] as string[], fail: "" }));
const organize = vi.hoisted(() => ({
  pinned: vi.fn(),
  archived: vi.fn(),
  unread: vi.fn(),
  filed: vi.fn(),
  fork: vi.fn(() => "forked"),
  rename: vi.fn(async () => undefined),
}));
vi.mock("@/features/agents", () => ({
  AgentAvatar: () => null,
  shortAgo: () => "1h",
  isChatUnread: (chat: SidebarChat) => Boolean(chat.markedUnread),
  setChatsPinned: organize.pinned,
  setChatsArchived: organize.archived,
  setChatsUnread: organize.unread,
  fileChats: organize.filed,
  forkChat: organize.fork,
  useChatSectionsStore: (pick: (state: { folders: unknown[] }) => unknown) =>
    pick({ folders: [{ id: "s1", name: "Research" }] }),
  useMistyStore: {
    getState: () => ({
      conversations: [],
      renameConversation: organize.rename,
      deleteConversation: async (id: string) => {
        if (id === removed.fail)
          throw new Error("Stop the response before deleting this conversation.");
        removed.ids.push(id);
      },
    }),
  },
}));

import { SidebarChats } from "./SidebarChats";

const agent = { id: "a1", name: "Codex" } as AgentProfile;
const base: SidebarChat[] = ["one", "two", "three"].map((id) => ({
  id,
  title: `Chat ${id}`,
  updatedAt: "",
}));
const onOpen = vi.fn();
const onOpenIn = vi.fn();
const onOpenGone = vi.fn();
const show = (openChat: string | null = null, chats = base) =>
  render(
    <SidebarChats
      chats={chats}
      agentOf={() => agent}
      statuses={{}}
      openChat={openChat}
      onOpen={onOpen}
      onOpenIn={onOpenIn}
      onOpenGone={onOpenGone}
    />,
  );
const row = (name: string) => screen.getByRole("button", { name: new RegExp(name) });
const menu = (name: string) => {
  fireEvent.contextMenu(row(name));
  return screen.getByRole("menu");
};

beforeEach(() => {
  removed.ids = [];
  removed.fail = "";
  for (const spy of Object.values(organize)) spy.mockClear();
  onOpen.mockReset();
  onOpenIn.mockReset();
  onOpenGone.mockReset();
});
afterEach(cleanup);

it("opens a chat on a plain click", () => {
  show();
  fireEvent.click(row("Chat two"));
  expect(onOpen).toHaveBeenCalledWith(agent, "two");
});

it("highlights picked chats without checkboxes or a delete button in the list", () => {
  show();
  fireEvent.click(row("Chat one"), { metaKey: true });
  fireEvent.click(row("Chat three"), { shiftKey: true });
  expect(onOpen).not.toHaveBeenCalled();
  for (const name of ["Chat one", "Chat two", "Chat three"])
    expect(row(name).hasAttribute("data-selected")).toBe(true);
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  // A plain click lets the pick go and opens the chat.
  fireEvent.click(row("Chat two"));
  expect(row("Chat one").hasAttribute("data-selected")).toBe(false);
  expect(onOpen).toHaveBeenCalledWith(agent, "two");
});

it("offers the chat's actions with their keys on right-click", () => {
  show();
  const items = within(menu("Chat one"))
    .getAllByRole("menuitem")
    .map((item) => item.textContent);
  expect(items).toEqual([
    "Open in",
    "PinP",
    "Mark as unreadU",
    "RenameR",
    "ForkF",
    "Move to section",
    "ArchiveA",
    "DeleteD",
  ]);
});

it("runs an action from its key while the menu is open", () => {
  show();
  fireEvent.keyDown(menu("Chat two"), { key: "p" });
  expect(organize.pinned).toHaveBeenCalledWith(["two"], true);
});

it("deletes a picked set from the menu after asking", async () => {
  show("two");
  fireEvent.click(row("Chat one"), { metaKey: true });
  fireEvent.click(row("Chat three"), { shiftKey: true });
  fireEvent.click(within(menu("Chat three")).getByRole("menuitem", { name: /Delete 3 chats/ }));
  expect(screen.getByRole("alertdialog").textContent).toContain("Delete 3 chats?");
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(removed.ids).toEqual(["one", "two", "three"]));
  // The open chat went with them, so the page is sent somewhere else.
  expect(onOpenGone).toHaveBeenCalledTimes(1);
});

it("deletes nothing when the person cancels", async () => {
  show();
  fireEvent.click(within(menu("Chat one")).getByRole("menuitem", { name: /Delete/ }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(removed.ids).toEqual([]);
});

it("says why a chat that is still answering stays", async () => {
  removed.fail = "two";
  show();
  fireEvent.click(within(menu("Chat two")).getByRole("menuitem", { name: /Delete/ }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.getByText(/Stop the response/)).toBeTruthy());
  expect(removed.ids).toEqual([]);
});

it("renames a chat in place", () => {
  show();
  fireEvent.click(within(menu("Chat one")).getByRole("menuitem", { name: /Rename/ }));
  const field = screen.getByRole("textbox", { name: "Chat name" });
  fireEvent.change(field, { target: { value: "Better name" } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(organize.rename).toHaveBeenCalledWith("one", "Better name");
});

it("forks a chat and opens the copy", () => {
  show();
  fireEvent.click(within(menu("Chat one")).getByRole("menuitem", { name: /Fork/ }));
  expect(organize.fork).toHaveBeenCalledWith("one");
  expect(onOpen).toHaveBeenCalledWith(agent, "forked");
});

it("groups pinned, sectioned and archived chats", () => {
  show(null, [
    { ...base[0]!, pinnedAt: "x" },
    { ...base[1]!, folderId: "s1" },
    { ...base[2]!, archivedAt: "x" },
  ]);
  const heads = screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"));
  expect(heads).toEqual(["Pinned", "Research", "Archived"]);
  // Archived chats stay folded until their head is opened.
  expect(screen.queryByRole("button", { name: /Chat three/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Archived/ }));
  expect(within(menu("Chat three")).getByRole("menuitem", { name: /Unarchive/ })).toBeTruthy();
});
