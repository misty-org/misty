import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  agent: { id: "ag", engine: "claude", enabled: true, space_id: "s1" } as Record<
    string,
    unknown
  > | null,
  conversation: vi.fn((props: { conversationId?: string; initialDraft?: string }) => (
    <div>
      Chat {props.conversationId} · {props.initialDraft}
    </div>
  )),
  video: { keep: vi.fn(async () => undefined), close: vi.fn() },
}));

vi.mock("../conversations/view/AgentWorkspaceConversation", () => ({
  AgentWorkspaceConversation: hoisted.conversation,
}));
vi.mock("../personal/agentAccount", async (original) => ({
  ...(await original<object>()),
  useAgentAccountId: () => "acct",
}));
vi.mock("../personal/personalAgentsStore", () => ({
  usePersonalAgentsStore: (pick: (state: { agents: unknown[] }) => unknown) =>
    pick({ agents: hoisted.agent ? [hoisted.agent] : [] }),
  defaultAgentOf: (agents: unknown[]) => agents[0],
}));
vi.mock("../personal/agentHomeSpace", () => ({
  homeSpaceOf: (_account: string, agent: { space_id: string }) => agent.space_id,
}));
vi.mock("../spaces-gateway/spacesGateway", () => ({
  spacesGateway: { maybe: () => ({ openLibraryVideo: vi.fn(async () => hoisted.video) }) },
}));

import { useMistyStore } from "../conversations/state/useMistyStore";
import { noteBeforeVideoChange, videoTurnsFor } from "../tools/space/videoTurns";
import { revertVideoTurn, VideoAgentPanel } from "./VideoAgentPanel";

const kept = {
  kind: "misty.video" as const,
  version: 1 as const,
  project: { metadata: { id: "p", updatedAt: "2026-01-01T00:00:00Z" } },
  media: [],
};

beforeEach(() => {
  hoisted.agent = { id: "ag", engine: "claude", enabled: true, space_id: "s1" };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the video editor's Agent tab", () => {
  it("chats with the person's agent about the open project, in a chat of the project's own", () => {
    render(<VideoAgentPanel spaceId="s1" itemId="p1" name="Trip" />);
    const conversation = useMistyStore.getState().conversations[0];
    expect(conversation.title).toBe("Video: Trip");
    expect(screen.getByText(new RegExp(`Chat ${conversation.id}`))).toBeTruthy();
    expect(screen.getByText(/About the video “Trip” \(Media item p1\)/)).toBeTruthy();
    cleanup();
    // Opened again, it is the same chat.
    render(<VideoAgentPanel spaceId="s1" itemId="p1" name="Trip" />);
    expect(screen.getByText(new RegExp(`Chat ${conversation.id}`))).toBeTruthy();
  });

  it("isn't there where the agent's tools can't reach the project", () => {
    hoisted.agent = { id: "ag", engine: "claude", enabled: true, space_id: "elsewhere" };
    const { container } = render(<VideoAgentPanel spaceId="s1" itemId="p2" name="Trip" />);
    expect(container.textContent).toBe("");
  });

  it("lists each turn that changed the project, and takes one back as the newest change", async () => {
    noteBeforeVideoChange("run-9", "s1", "p3", kept);
    render(<VideoAgentPanel spaceId="s1" itemId="p3" name="Trip" />);
    expect(screen.getByRole("list", { name: "Changes your agent made" })).toBeTruthy();
    await act(async () => screen.getByRole("button", { name: "Revert" }).click());
    const [restored] = hoisted.video.keep.mock.calls[0] as unknown as [typeof kept];
    expect(restored.media).toEqual([]);
    expect(Date.parse(restored.project.metadata.updatedAt)).toBeGreaterThan(
      Date.parse("2026-01-01"),
    );
    expect(hoisted.video.close).toHaveBeenCalled();
    expect(videoTurnsFor("p3")).toEqual([]);
    expect(screen.queryByRole("button", { name: "Revert" })).toBeNull();
  });

  it("does nothing for a turn it doesn't know", async () => {
    await revertVideoTurn("unknown", "p1");
    expect(hoisted.video.keep).not.toHaveBeenCalled();
  });
});
