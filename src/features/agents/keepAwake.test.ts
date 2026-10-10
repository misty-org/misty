import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args?: unknown) => undefined),
  keepAwake: true,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/features/ai-surface/api", () => ({
  aiSurfaceApi: {
    settings: async () => ({ settings: { keep_awake_for_agents: mocks.keepAwake } }),
  },
}));
import { holdAwake, releaseAwake, setKeepAwakeForAgents } from "./keepAwake";

const holds = () =>
  mocks.invoke.mock.calls
    .filter(([command]) => command === "power_keep_awake")
    .map(([, args]) => (args as { hold: boolean }).hold);

beforeEach(() => mocks.invoke.mockClear());

it("holds the computer awake while any agent work remains, and only once", async () => {
  await holdAwake("local");
  await holdAwake("hosted:a");
  await releaseAwake("local");
  expect(holds()).toEqual([true]);
  await releaseAwake("hosted:a");
  expect(holds()).toEqual([true, false]);
});

it("follows the account setting, at once when it changes", async () => {
  await setKeepAwakeForAgents(false);
  await holdAwake("local");
  expect(holds()).toEqual([]);
  await setKeepAwakeForAgents(true);
  expect(holds()).toEqual([true]);
  await setKeepAwakeForAgents(false);
  expect(holds()).toEqual([true, false]);
  await releaseAwake("local");
  await setKeepAwakeForAgents(true);
  expect(holds()).toEqual([true, false]);
});
