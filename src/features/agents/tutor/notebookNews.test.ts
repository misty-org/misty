import { beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/shared/platform/nativeInvoke", () => ({ invoke: native.invoke }));

import { latestNews } from "./notebookNews";

beforeEach(() => native.invoke.mockReset());

it("searches news with or without a period", async () => {
  native.invoke.mockResolvedValue([]);
  await latestNews("AI agents", "week");
  expect(native.invoke).toHaveBeenLastCalledWith("notebook_news", {
    query: "AI agents",
    recency: "week",
  });
  await latestNews("AI agents");
  expect(native.invoke).toHaveBeenLastCalledWith("notebook_news", {
    query: "AI agents",
    recency: null,
  });
});
