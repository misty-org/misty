import "./agentCloudAvatars.testFixtures";
import { expect, it } from "vitest";
import { agentOutputs } from "./AgentOverviewPanel";
import type { GlobalAiConversation } from "@/features/global-search/types";
it("shows only completed assistant outputs, newest first, deduplicating explicit internal destinations", () => {
  const messages = [
    {
      role: "assistant",
      action: { state: "completed", title: "Old", resultHref: "/spaces/personal/planner" },
    },
    { role: "user", action: { state: "completed", resultHref: "/spaces/personal/private" } },
    { role: "assistant", action: { state: "failed", resultHref: "/spaces/personal/failed" } },
    { role: "assistant", action: { state: "completed", resultHref: "https://example.com/" } },
    { role: "assistant", action: { state: "completed", resultHref: "/spaces/../settings" } },
    {
      role: "assistant",
      action: { state: "completed", title: "New", resultHref: "/spaces/personal/planner" },
    },
  ];
  expect(agentOutputs([{ updatedAt: "2026-09-30", messages }] as GlobalAiConversation[])).toEqual([
    { href: "/spaces/personal/planner", title: "New" },
  ]);
});
