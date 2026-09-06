import "./globalMistyState.testFixtures";
import { assertMistyAvailable } from "@/features/misty/availability";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { useSpacesStore } from "@/features/spaces";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("Global Misty prompt echo", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useMistyStore.getState().setAccount("");
    useMistyStore.setState({
      panel: "closed",
      working: false,
      context: [],
      handoff: undefined,
      targets: [],
      thinkingMode: "normal",
    });
    useSpacesStore.setState({
      spaces: [],
    });
  });
  it("shows the prompt before preparation and takes it back if preparation fails", async () => {
    let fail!: (error: Error) => void;
    vi.mocked(assertMistyAvailable).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    useMistyStore.setState({
      accountId: "account-a",
      working: false,
      query: "Draft the launch note",
      selectedAgentId: "default-misty",
      activeConversationId: "conversation-a",
      conversations: [
        {
          id: "conversation-a",
          agentId: "default-misty",
          title: "Misty",
          createdAt: "2026-10-08",
          updatedAt: "2026-10-08",
          messages: [],
          remote: true,
        },
      ],
    });
    const pending = useMistyStore.getState().submitAnswer("Draft the launch note");
    // Same update as `working`: the message, then its pending answer, never a bare status.
    expect(useMistyStore.getState()).toMatchObject({ working: true, query: "" });
    expect(
      useMistyStore.getState().conversations[0].messages.map((m) => [m.role, m.state]),
    ).toEqual([
      ["user", "completed"],
      ["assistant", "pending"],
    ]);
    fail(new Error("Agents unavailable"));
    await pending;
    expect(useMistyStore.getState()).toMatchObject({
      working: false,
      query: "Draft the launch note",
      error: "Agents unavailable",
    });
    expect(useMistyStore.getState().conversations[0].messages).toEqual([]);
  });
});
