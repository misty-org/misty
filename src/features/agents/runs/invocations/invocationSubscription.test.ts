import { beforeEach, expect, it, vi } from "vitest";
import type { AiInvocationEvent } from "./invocationTypes";

const native = vi.hoisted(() => ({
  follow: vi.fn(),
  live: undefined as undefined | ((event: unknown) => void),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.follow }));
vi.mock("../local-run/localRunEvents", () => ({
  followLocalRunEvents: (_run: string, listener: (event: unknown) => void) => {
    native.live = listener;
    return () => {
      native.live = undefined;
    };
  },
}));

import { subscribeToAiInvocation } from "./invocationSubscription";

const event = (id: string, type = "assistant.status") => ({ id, type }) as AiInvocationEvent;

const collect = () => {
  const seen: string[] = [];
  const errors: string[] = [];
  const stop = subscribeToAiInvocation("agent-run:run", {
    onEvent: (item) => seen.push((item as { id: string }).id),
    onError: (error) => errors.push(error.message),
  });
  return { seen, errors, stop };
};

beforeEach(() => {
  native.follow.mockReset();
});

it("replays what the run said, then follows it, each event once and in order", async () => {
  let answer!: (value: unknown) => void;
  native.follow.mockReturnValue(new Promise((done) => (answer = done)));
  const { seen } = collect();
  // These arrive while the kept events are being read, and one of them is among them.
  native.live?.(event("run:2"));
  native.live?.(event("run:3"));
  expect(seen).toEqual([]);
  answer({ state: "running", events: [event("run:1"), event("run:2")] });
  await vi.waitFor(() => expect(seen).toEqual(["run:1", "run:2", "run:3"]));
  native.live?.(event("run:3"));
  native.live?.(event("run:4"));
  expect(seen).toEqual(["run:1", "run:2", "run:3", "run:4"]);
});

it("stops delivering once it's stopped", async () => {
  native.follow.mockResolvedValue({ state: "running", events: [event("run:1")] });
  const { seen, stop } = collect();
  stop();
  await new Promise((done) => setTimeout(done));
  expect(seen).toEqual([]);
});

it("says so when nothing knows of the run", async () => {
  native.follow.mockResolvedValue({ state: "missing", events: [] });
  const { errors } = collect();
  await vi.waitFor(() => expect(errors).toEqual(["This run stopped before it finished."]));
});

it("passes on a follow that fails", async () => {
  native.follow.mockRejectedValue(new Error("no runtime"));
  const { errors } = collect();
  await vi.waitFor(() => expect(errors).toEqual(["no runtime"]));
});
