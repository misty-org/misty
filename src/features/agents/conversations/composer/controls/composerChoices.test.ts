import type * as Actual from "@/shared/platform/tauri";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => {
  const { fakeInvoke } = await import("@/features/agents/tools/run-state/fakeMistyDb.test-support");
  return { invoke: fakeInvoke };
});
vi.mock("@/shared/platform/tauri", async (actual) => ({
  ...(await actual<typeof Actual>()),
  hasTauriInternals: () => true,
}));

import { rows, settings } from "@/features/agents/tools/run-state/fakeMistyDb.test-support";
import { settleDeviceSettings } from "@/tests/fakeDeviceSettings";
import { rememberedEffort, useComposerChoices, useModelEfforts } from "./composerChoices";

beforeEach(() => {
  rows.clear();
  useComposerChoices.setState({ byConversation: {}, draft: { model: "", effort: "" } });
});

it("applies a choice onto the chat's stored choices, keeping the ones not changed", async () => {
  rows.set("me/composer/chat", JSON.stringify({ model: "opus", effort: "high" }));
  // Picked before this window loaded the chat's saved choices.
  useComposerChoices.getState().choose("me", "chat", { effort: "low" });
  await vi.waitFor(() =>
    expect(useComposerChoices.getState().byConversation.chat).toEqual({
      model: "opus",
      effort: "low",
    }),
  );
  expect(JSON.parse(rows.get("me/composer/chat")!)).toEqual({ model: "opus", effort: "low" });
});

it("keeps a new chat's choice as the draft, saving nothing", async () => {
  useComposerChoices.getState().choose("me", undefined, { model: "sonnet" });
  expect(useComposerChoices.getState().draft).toEqual({ model: "sonnet", effort: "" });
  await settleDeviceSettings();
  expect(rows.size).toBe(0);
});

it("remembers each model's effort for the device in misty.db", async () => {
  useModelEfforts.getState().remember("claude", "opus", "high");
  expect(rememberedEffort("claude", "opus")).toBe("high");
  await settleDeviceSettings();
  expect(settings.get("model-efforts")?.state).toEqual({
    deviceSetting: 1,
    value: { "claude:opus": "high" },
  });
});
