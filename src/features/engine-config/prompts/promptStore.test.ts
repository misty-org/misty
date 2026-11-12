// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomPromptEntry } from "./promptsApi";

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));
vi.mock("./promptsApi", () => ({ listPrompts: mocks.list, createPromptFile: mocks.create }));

const { createPrompt, matchPrompts, promptsFor, usePromptStore } = await import("./promptStore");

const entry = (name: string, extra: Partial<CustomPromptEntry> = {}): CustomPromptEntry => ({
  name,
  path: `/p/${name}.md`,
  content: "",
  scope: "global",
  ...extra,
});

beforeEach(() => {
  mocks.list.mockReset();
  mocks.create.mockReset();
  usePromptStore.setState({ byRoot: {} });
});

describe("prompt library", () => {
  it("matches name, description and body, keeping the order", () => {
    const entries = [
      entry("review", { description: "Look at the diff" }),
      entry("plan", { content: "Write a review plan" }),
      entry("ship"),
    ];
    expect(matchPrompts(entries, "REVIEW").map((e) => e.name)).toEqual(["review", "plan"]);
    expect(matchPrompts(entries, "diff").map((e) => e.name)).toEqual(["review"]);
    expect(matchPrompts(entries, "  ")).toBe(entries);
  });

  it("reads a folder once and then serves the cache", async () => {
    mocks.list.mockResolvedValue([entry("a")]);
    expect((await promptsFor("/repo")).map((e) => e.name)).toEqual(["a"]);
    expect((await promptsFor("/repo")).map((e) => e.name)).toEqual(["a"]);
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledWith("/repo");
  });

  it("keeps the old entries when a refresh fails", async () => {
    mocks.list.mockResolvedValueOnce([entry("a")]).mockRejectedValueOnce(new Error("gone"));
    await usePromptStore.getState().refresh("");
    await usePromptStore.getState().refresh("");
    const cached = usePromptStore.getState().byRoot[""];
    expect(cached?.status).toBe("error");
    expect(cached?.entries.map((e) => e.name)).toEqual(["a"]);
  });

  it("refreshes every folder after a change, since global prompts show in all", async () => {
    mocks.list.mockResolvedValue([]);
    await usePromptStore.getState().refresh("/one");
    await usePromptStore.getState().refresh("/two");
    mocks.list.mockClear();
    mocks.create.mockResolvedValue(entry("new"));
    await createPrompt("/one", "global", { name: "new", content: "x" });
    expect(mocks.list.mock.calls.map(([root]) => root).sort()).toEqual(["/one", "/two"]);
  });
});
