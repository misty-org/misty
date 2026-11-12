import "@/tests/ports/spaces";
import { beforeEach, expect, it } from "vitest";
import { useSpaceWindowStore } from "@/features/app-windows";
import { useMistyStore } from "../../state/useMistyStore";
import { newLocalConversation } from "../../state/localConversation";
import { moveChatToSpace } from "./ChatSpaceMenu";

beforeEach(() => {
  useSpaceWindowStore.setState({
    identity: { key: "personal", spaceId: null, personal: true },
    personalSpaceId: "home",
  });
  useMistyStore.setState({ conversations: [], draftSpaceId: undefined });
});

it("moves a chat to another Space, and back to the personal one", () => {
  const chat = newLocalConversation("Plan");
  useMistyStore.setState({ conversations: [chat] });
  expect(chat).toMatchObject({ spaceId: "home", personalSpace: true });

  moveChatToSpace(chat.id, "team");
  expect(useMistyStore.getState().conversations[0]).toMatchObject({ spaceId: "team" });
  expect(useMistyStore.getState().conversations[0].personalSpace).toBeUndefined();

  moveChatToSpace(chat.id, "home");
  expect(useMistyStore.getState().conversations[0]).toMatchObject({
    spaceId: "home",
    personalSpace: true,
  });
});

it("makes a new chat in the Space picked before its first message", async () => {
  moveChatToSpace(undefined, "team");
  expect(useMistyStore.getState().draftSpaceId).toBe("team");
  const id = await useMistyStore.getState().newConversation();
  const made = useMistyStore.getState().conversations.find((chat) => chat.id === id);
  expect(made).toMatchObject({ spaceId: "team" });
  expect(useMistyStore.getState().draftSpaceId).toBeUndefined();
});

it("keeps no pick for a new chat when it is the window's own Space", () => {
  moveChatToSpace(undefined, "home");
  expect(useMistyStore.getState().draftSpaceId).toBeUndefined();
});
