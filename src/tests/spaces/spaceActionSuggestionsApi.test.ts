import { describe, expect, it, vi } from "vitest";
import { createSpaceActionSuggestionsApi } from "@/stores/spaces/spaceActionSuggestionsApi";

describe("space action suggestions API", () => {
  it("submits only reviewed item, agent, and locked payload", async () => {
    const request = vi.fn().mockResolvedValue({ suggestion: {}, runs: [], follow_ups: [] });
    const api = createSpaceActionSuggestionsApi(request);
    await api.acceptActionSuggestion("space 1", "batch 1", 4, [
      {
        item_id: "item-1",
        selected_agent_id: "agent-1",
        approved_input: { title: "Reviewed title" },
      },
    ]);
    expect(request).toHaveBeenCalledWith("/spaces/space%201/action-suggestions/batch%201/accept", {
      method: "POST",
      body: JSON.stringify({
        version: 4,
        items: [
          {
            item_id: "item-1",
            selected_agent_id: "agent-1",
            approved_input: { title: "Reviewed title" },
          },
        ],
      }),
    });
  });

  it("uses the caller-owned veto endpoints", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const api = createSpaceActionSuggestionsApi(request);
    await api.setConversationSuggestionVeto("space", "chat", true);
    await api.setConversationSuggestionVeto("space", "chat", false);
    expect(request.mock.calls.map((call) => call[1]?.method)).toEqual(["PUT", "DELETE"]);
  });
});
