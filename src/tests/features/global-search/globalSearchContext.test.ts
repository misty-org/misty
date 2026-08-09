import { describe, expect, it } from "vitest";
import { globalSearchContext, useGlobalSearchStore } from "@/features/global-search";

describe("globalSearchContext", () => {
  it("turns ranked results into a bounded LLM-ready retrieval context", () => {
    const context = globalSearchContext(
      [
        {
          id: "task:1",
          accountId: "account-1",
          kind: "task",
          title: "Ship beta",
          body: "x".repeat(400),
          keywords: ["launch"],
          href: "/spaces/space-1/planner/tasks/board?task=1",
          spaceName: "Launch",
          source: "server",
          score: 10,
        },
      ],
      1,
    );

    expect(context).toEqual([
      expect.objectContaining({
        kind: "task",
        title: "Ship beta",
        space: "Launch",
        source: "server",
      }),
    ]);
    expect(context[0]?.snippet).toHaveLength(280);
  });

  it("clears query data when the active account changes", () => {
    useGlobalSearchStore.setState({
      accountId: "account-1",
      query: "private launch",
      results: [
        {
          id: "space:1",
          accountId: "account-1",
          kind: "space",
          title: "Private",
          body: "",
          keywords: [],
          href: "/spaces/1",
          source: "local",
          score: 1,
        },
      ],
    });
    useGlobalSearchStore.getState().setAccount("account-2");
    expect(useGlobalSearchStore.getState()).toMatchObject({
      accountId: "account-2",
      query: "",
      results: [],
    });
  });
});
