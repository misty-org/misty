import type { SpaceMessage } from "@/api/spaces/dto/interfaces/types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ links: vi.fn(), publishMessage: vi.fn() }));
vi.mock("@/api/integrations/slack", () => ({ spaceSlackApi: api }));
import { useSlackPublish } from "./useSlackPublish";

describe("useSlackPublish", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    api.links.mockResolvedValue({
      links: [
        {
          id: "link-1",
          conversation_id: "conversation-1",
          direction: "two_way",
          status: "active",
        },
      ],
    });
    api.publishMessage.mockResolvedValue({ message: message() });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("does not publish until the eligible user clicks", async () => {
    const onPublished = vi.fn();
    await act(async () => {
      root.render(<Probe onPublished={onPublished} />);
    });
    await vi.waitFor(() => expect(container.querySelector("button")).not.toBeNull());
    expect(api.publishMessage).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(api.publishMessage).toHaveBeenCalledWith("space-1", "link-1", "message-1", "123.45");
    expect(onPublished).toHaveBeenCalledOnce();
  });
});

function Probe({ onPublished }: { onPublished: (message: SpaceMessage) => void }) {
  const publish = useSlackPublish("space-1", "conversation-1", "user-1", onPublished);
  const item = message();
  return publish.canPublish(item) ? (
    <button type="button" onClick={() => void publish.publish(item, "123.45")}>
      Publish
    </button>
  ) : null;
}

function message(): SpaceMessage {
  return {
    seq: 1,
    id: "message-1",
    space_id: "space-1",
    conversation_id: "conversation-1",
    sender_user_id: "user-1",
    sender_name: "Rey",
    sender_kind: "person",
    content: [{ type: "text", text: "Ship it" }],
    file_node_ids: [],
    reactions: [],
    created_at: "2026-08-19T00:00:00Z",
  };
}
