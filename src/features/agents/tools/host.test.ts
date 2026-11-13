import { describe, expect, it } from "vitest";
import { answerFor, LocalToolRejected, LocalToolUncertain, registerLocalTools } from "./host";

const ask = (name: string, input: unknown = { a: 1 }) =>
  answerFor({ run_id: "run", call_id: "call", name, input }, new AbortController().signal);

describe("answerFor", () => {
  it("answers with what the tool returned, and gives it the call", async () => {
    registerLocalTools({
      "test.echo": async (request) => ({ run: request.runId, input: request.input }),
    });
    await expect(ask("test.echo")).resolves.toEqual({
      state: "done",
      result: { run: "run", input: { a: 1 } },
    });
  });

  it("refuses a tool this computer doesn't have", async () => {
    await expect(ask("test.missing")).resolves.toMatchObject({
      state: "failed",
      code: "tool_unavailable",
    });
  });

  it("keeps a refusal's code, so the model can correct the call", async () => {
    registerLocalTools({
      "test.refuse": async () => {
        throw new LocalToolRejected("bad_input", "Pass a scope.");
      },
    });
    await expect(ask("test.refuse")).resolves.toEqual({
      state: "failed",
      code: "bad_input",
      message: "Pass a scope.",
    });
  });

  it("treats any other failure as uncertain, never as nothing having happened", async () => {
    registerLocalTools({
      "test.uncertain": async () => {
        throw new LocalToolUncertain("The tab went away mid-click.");
      },
      "test.throws": async () => {
        throw new Error("boom");
      },
    });
    await expect(ask("test.uncertain")).resolves.toEqual({
      state: "uncertain",
      message: "The tab went away mid-click.",
    });
    await expect(ask("test.throws")).resolves.toEqual({ state: "uncertain", message: "boom" });
  });

  it("reads anything but an object as empty input", async () => {
    registerLocalTools({ "test.input": async (request) => request.input });
    await expect(ask("test.input", "text")).resolves.toEqual({ state: "done", result: {} });
    await expect(ask("test.input", [1])).resolves.toEqual({ state: "done", result: {} });
  });
});
