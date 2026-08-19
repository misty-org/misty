import { beforeEach, describe, expect, it, vi } from "vitest";

const spaceRequest = vi.hoisted(() => vi.fn());
vi.mock("@/api/spaces/api", () => ({ spaceRequest }));

import { spaceSlackApi } from "./slack";

describe("spaceSlackApi", () => {
  beforeEach(() => spaceRequest.mockReset());

  it("uses the canonical Slack link routes and envelopes", async () => {
    spaceRequest.mockResolvedValue({ links: [] });
    await spaceSlackApi.links("space / 1");
    await spaceSlackApi.createLink("space / 1", {
      integration_id: "integration-1",
      channel_id: "channel-1",
      direction: "two_way",
    });
    await spaceSlackApi.updateLink("space / 1", "link / 1", "inbound");
    await spaceSlackApi.sync("space / 1", "link / 1");

    expect(spaceRequest.mock.calls[0]?.[0]).toBe(
      "/spaces/space%20%2F%201/integrations/slack/links",
    );
    expect(JSON.parse(spaceRequest.mock.calls[1]?.[1].body)).toEqual({
      integration_id: "integration-1",
      channel_id: "channel-1",
      direction: "two_way",
    });
    expect(spaceRequest.mock.calls[2]).toEqual([
      "/spaces/space%20%2F%201/integrations/slack/links/link%20%2F%201",
      { method: "PATCH", body: JSON.stringify({ direction: "inbound" }) },
    ]);
    expect(spaceRequest.mock.calls[3]?.[0]).toContain("/link%20%2F%201/sync");
  });

  it("publishes only through the explicit message endpoint", async () => {
    await spaceSlackApi.publishMessage("space-1", "link-1", "message-1", "123.45");

    expect(spaceRequest).toHaveBeenCalledWith(
      "/spaces/space-1/integrations/slack/links/link-1/publish",
      {
        method: "POST",
        body: JSON.stringify({ message_id: "message-1", thread_ts: "123.45" }),
      },
    );
  });
});
