import { describe, expect, it, vi } from "vitest";
import { LocalToolRejected } from "@/features/agents";
import {
  acknowledge,
  answerAppCall,
  registerAppTools,
  unregisterAppTools,
} from "./app_tool_server";

const invoked = vi.hoisted(() => ({ calls: [] as unknown[], refuse: false }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: unknown) => {
    invoked.calls.push({ command, args });
    if (invoked.refuse) throw new Error("That tool call is no longer waiting.");
  },
}));

const asked = (instance: string, name = "app.draw.crop") => ({
  id: "call-1",
  run_id: "run",
  call_id: "call",
  name,
  input: { a: 1 },
  instance,
});

describe("answerAppCall", () => {
  it("answers from the instance the call was routed to, never another", async () => {
    registerAppTools("here", { "app.draw.crop": async () => ({ from: "here" }) });
    registerAppTools("there", { "app.draw.crop": async () => ({ from: "there" }) });
    const signal = new AbortController().signal;
    await expect(answerAppCall(asked("here"), signal)).resolves.toEqual({
      state: "done",
      result: { from: "here" },
    });
    unregisterAppTools("here");
    await expect(answerAppCall(asked("here"), signal)).resolves.toMatchObject({
      state: "failed",
      code: "tool_unavailable",
    });
    unregisterAppTools("there");
  });

  it("keeps a refusal definite and anything else uncertain", async () => {
    registerAppTools("one", {
      "app.draw.no": async () => {
        throw new LocalToolRejected("bad_input", "Pass a size.");
      },
      "app.draw.lost": async () => {
        throw new Error("The app didn't answer.");
      },
    });
    const signal = new AbortController().signal;
    await expect(answerAppCall(asked("one", "app.draw.no"), signal)).resolves.toEqual({
      state: "failed",
      code: "bad_input",
      message: "Pass a size.",
    });
    await expect(answerAppCall(asked("one", "app.draw.lost"), signal)).resolves.toEqual({
      state: "uncertain",
      message: "The app didn't answer.",
    });
    unregisterAppTools("one");
  });
});

describe("acknowledge", () => {
  it("tells Misty the call arrived, and says so only when Misty still waits for it", async () => {
    invoked.calls.length = 0;
    invoked.refuse = false;
    await expect(acknowledge("call-1")).resolves.toBe(true);
    expect(invoked.calls).toEqual([
      { command: "agent_tool_finish", args: { id: "call-1", answer: { state: "received" } } },
    ]);
    invoked.refuse = true;
    await expect(acknowledge("call-2")).resolves.toBe(false);
    invoked.refuse = false;
  });
});
