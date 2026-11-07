import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EvalClient } from "../client.ts";
import { composerRequest, didNoWork } from "../perform.ts";
import { Recorder, summarize, visual } from "../recorder.ts";
import { summary, line } from "../results.ts";
import type { OdysseysTask } from "../tasks.ts";
import { ProgressWatch } from "../watchdog.ts";
import { sendJson, startMock, type Mock } from "./mock.ts";

let mock: Mock | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const run = "invocation_1";
const token = "token";
/** The debug bridge, with a run that has said these events. */
const bridgeWith = (events: unknown[], state = "completed") =>
  startMock((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) return sendJson(response, 401, {});
    if (request.path === "/window-eval") return sendJson(response, 200, { ok: true, result: { invocationId: run, conversationId: "conversation_1" } });
    if (request.path === "/run-follow") return sendJson(response, 200, { ok: true, result: { state, events } });
    if (request.path === "/run-record") return sendJson(response, 200, { ok: true, result: [{ tool_call_id: "call_1", tool_name: "browser.run", output: { url: "https://a.test", title: "A" } }] });
    sendJson(response, 200, { ok: true, result: { ok: true } });
  });
const clientOf = (server: Mock) => new EvalClient({ url: server.url, token });
const task = { id: "t", prompt: "Find a hotel.", startUrl: "", level: "easy", referenceLength: 1, rubrics: [], split: "dev" } satisfies OdysseysTask;
const identity = { agentId: "a", deviceId: "device_1" };

describe("driving the product path", () => {
  it("starts a composer request in the app with the eval's turn limit, and follows the run", async () => {
    mock = await bridgeWith([
      { type: "invocation.started" },
      { type: "tool.started", toolCallId: "call_1", toolName: "browser.run" },
      { type: "tool.completed", toolCallId: "call_1", toolName: "browser.run" },
      { type: "response.delta", delta: "Hel" },
      { type: "response.delta", delta: "lo" },
      { type: "invocation.completed" },
    ]);
    const client = clientOf(mock);
    const seen: unknown[] = [];
    const result = await client.run(composerRequest(task, identity, [{ deviceId: "device_1" }]), { timeoutMs: 5_000, turns: 100, observe: async (event) => void seen.push(event.type) });
    expect(result).toMatchObject({ invocationId: run, conversationId: "conversation_1", terminal: "invocation.completed", answer: "Hello", tools: ["browser_run"] });
    expect(seen[0]).toBe("eval.created");
    expect(client.active.size).toBe(0);
    expect(didNoWork(result)).toBe(false);

    const started = mock.seen.find((item) => item.path === "/window-eval")!;
    const { script } = JSON.parse(started.body) as { script: string };
    expect(script).toContain("aiSurfaceApi.createInvocation(request)");
    expect(script).toContain('"prompt":"Find a hotel."');
    expect(script).toContain('"evalTurnLimit":100');
    expect(script).toContain('"permissionMode":"auto"');
    expect(script).toContain('"executionMode":"user"');
  });

  it("never names a model: the device's settings choose it", () => {
    const body = composerRequest(task, identity, []);
    expect(Object.keys(body).filter((key) => /model|effort|thinking|override/.test(key))).toEqual([]);
  });

  it("cancels a run that waits for a person", async () => {
    mock = await bridgeWith([{ type: "tool.started", toolName: "browser.run" }, { type: "app.request", appRequest: { id: "r" } }, { type: "invocation.completed" }]);
    const result = await clientOf(mock).run({ prompt: "x" }, { timeoutMs: 5_000, turns: 100 });
    expect(result.terminal).toBe("needs_person:app.request");
    expect(mock.seen.some((item) => item.path === "/run-cancel")).toBe(true);
  });

  it("cancels a run nothing knows of, and records why a run failed", async () => {
    mock = await bridgeWith([{ type: "response.delta", delta: "partial" }], "missing");
    const closed = await clientOf(mock).run({ prompt: "x" }, { timeoutMs: 5_000, turns: 100 });
    expect(closed.terminal).toBe("stream.ended");
    expect(mock.seen.some((item) => item.path === "/run-cancel")).toBe(true);
    await mock.close();
    mock = await bridgeWith([{ type: "invocation.failed", error: "model_key_needed" }]);
    const failed = await clientOf(mock).run({ prompt: "x" }, { timeoutMs: 5_000, turns: 100 });
    expect(failed).toMatchObject({ terminal: "invocation.failed", error: "model_key_needed" });
    expect(didNoWork(failed)).toBe(true);
  });

  it("stops a run the watch gives up on, and cancels it", async () => {
    mock = await bridgeWith([], "running");
    const result = await clientOf(mock).run({ prompt: "x" }, { timeoutMs: Infinity, turns: 100, watch: { everyMs: 20, check: async () => "stalled: no activity" } });
    expect(result.terminal).toBe("stalled: no activity");
    expect(mock.seen.some((item) => item.path === "/run-cancel")).toBe(true);
  });

  it("reads what a run's tools answered from its journal", async () => {
    mock = await bridgeWith([]);
    const outputs = await clientOf(mock).toolOutputs(run);
    expect(outputs[0]).toMatchObject({ tool_call_id: "call_1", tool_name: "browser.run" });
  });
});

describe("the recorder", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "odysseys-recorder-"));
  const image = `data:image/jpeg;base64,${Buffer.from("picture").toString("base64")}`;
  const bridge = (pages: () => Array<{ label: string; url: string; runId?: string | null }>) =>
    startMock((request, response) => {
      if (request.headers.authorization !== "Bearer token") return sendJson(response, 401, {});
      if (request.path === "/pages") return sendJson(response, 200, { ok: true, result: { pages: pages() } });
      sendJson(response, 200, { ok: true, result: { dataUrl: image } });
    });

  it("knows which tools earn a picture, however they're named", () => {
    for (const tool of ["browser.run", "browser_run", "screen.open", "screen_open"]) expect(visual(tool), tool).toBe(true);
    for (const tool of ["web.fetch", "web_search", "screen.close", "shell.run"]) expect(visual(tool), tool).toBe(false);
  });

  it("records steps, their stored results and pictures of the run's own pages only", async () => {
    let open = [{ label: "misty-browser-person", url: "https://person.test" }] as Array<{ label: string; url: string; runId?: string | null }>;
    mock = await bridge(() => open);
    const folder = dir();
    const recorder = new Recorder(folder, { url: mock.url, token: "token" });
    await recorder.start();
    await recorder.observe({ type: "eval.created", invocationId: run });
    open = [...open,
      { label: "misty-browser-a", url: "https://a.test", runId: run },
      { label: "misty-browser-other", url: "https://other.test", runId: "invocation_other" },
      { label: "misty-browser-blank", url: "about:blank", runId: run },
    ];
    await recorder.observe({ type: "tool.started", toolCallId: "call_1", toolName: "browser.run" });
    await recorder.observe({ type: "tool.completed", toolCallId: "call_1", toolName: "browser_run" });
    await recorder.observe({ type: "tool.started", toolCallId: "call_2", toolName: "web.fetch" });
    await recorder.observe({ type: "tool.failed", toolCallId: "call_2", toolName: "web_fetch", error: "blocked" });
    recorder.applyOutputs([
      { tool_call_id: "call_1", tool_name: "browser.run", output: { url: "https://a.test", title: "A", other: "dropped" } },
      { tool_call_id: "call_2", tool_name: "web.fetch", output: { text: "later" } },
      { tool_call_id: "call_unknown", tool_name: "x", output: {} },
    ]);
    // A sub-agent's page counts as the run's.
    await recorder.observe({ type: "delegation.updated", delegation: { children: [{ invocationId: "invocation_child" }] } });
    open = [...open, { label: "misty-browser-child", url: "https://child.test", runId: "invocation_child" }];
    await recorder.finish("the answer");

    expect(recorder.steps.map((step) => step.action)).toEqual(["browser_run", "web_fetch", "final_answer"]);
    expect(recorder.steps[0]).toMatchObject({ response: "https://a.test | A", screenshots: ["shot-001.jpg"] });
    expect(recorder.steps[1]).toMatchObject({ response: "failed: blocked", screenshots: [] });
    expect(recorder.steps[2]).toMatchObject({ response: "the answer", screenshots: ["shot-002.jpg", "shot-003.jpg"] });
    const captures = mock.seen.filter((item) => item.path === "/capture").map((item) => (JSON.parse(item.body) as { label: string }).label);
    expect(captures).not.toContain("misty-browser-person");
    expect(captures).not.toContain("misty-browser-other");
    expect(captures).not.toContain("misty-browser-blank");
    expect(captures).toContain("misty-browser-child");
    expect(readFileSync(join(folder, "shot-001.jpg"), "utf8")).toBe("picture");
    expect(recorder.screenshots).toHaveLength(3);
    const lines = readFileSync(join(folder, "steps.jsonl"), "utf8").trim().split("\n").map((row) => JSON.parse(row) as { action: string });
    expect(lines.map((row) => row.action)).toEqual(["browser_run", "web_fetch", "final_answer"]);
  });

  it("doesn't picture an unchanged page twice during a run", async () => {
    mock = await bridge(() => [{ label: "misty-browser-a", url: "https://a.test", runId: run }]);
    const recorder = new Recorder(dir(), { url: mock.url, token: "token" });
    await recorder.observe({ type: "eval.created", invocationId: run });
    for (const id of ["1", "2"]) {
      await recorder.observe({ type: "tool.started", toolCallId: id, toolName: "browser.run" });
      await recorder.observe({ type: "tool.completed", toolCallId: id, toolName: "browser.run" });
    }
    expect(recorder.steps.map((step) => step.screenshots.length)).toEqual([1, 0]);
  });

  it("summarizes results to one short line", () => {
    expect(summarize(JSON.stringify({ url: "https://a.test", status: 200, snapshot: { tree: "a\n  b" } }))).toBe("https://a.test | 200 | a b");
    expect(summarize("not json")).toBe("not json");
    expect(summarize("x".repeat(700))).toHaveLength(600);
  });
});

describe("the progress watch", () => {
  const output = (id: string, text: string) => ({ tool_call_id: id, tool_name: "browser.run", output: { text } });

  it("keeps going while results are new", () => {
    const watch = new ProgressWatch("t");
    watch.observe({ type: "tool.started" });
    watch.results([output("1", "first")]);
    expect(watch.check()).toBeUndefined();
    watch.observe({ type: "tool.started" });
    watch.results([output("1", "first"), output("2", "second")]);
    expect(watch.check()).toBeUndefined();
  });

  it("stops a run that only repeats itself, ignoring ids and times", () => {
    const watch = new ProgressWatch("t");
    watch.results([output("1", "same at 2026-11-06T00:00:00Z")]);
    watch.check();
    for (const id of ["2", "3"]) {
      watch.observe({ type: "tool.started" });
      watch.results([output(id, `same at 2026-11-06T0${id}:00:00Z`)]);
      const reason = watch.check();
      if (id === "3") expect(reason).toContain("looping");
    }
  });

  it("stops a quiet run only after four looks", () => {
    const watch = new ProgressWatch("t");
    expect([watch.check(), watch.check(), watch.check()]).toEqual([undefined, undefined, undefined]);
    expect(watch.check()).toContain("stalled");
  });
});

describe("the pass summary", () => {
  it("leaves out runs the stack refused", () => {
    const base = { taskId: "abc", level: "easy", split: "dev", referenceLength: 2, error: "", failed: [], judgeErrors: 0, noWork: false, seconds: 10, judgeInputTokens: 1, judgeOutputTokens: 1, answer: "", dir: "", invocationId: "", conversationId: "" };
    const good = { ...base, terminal: "invocation.completed", perfect: true, average: 1, tools: ["a", "b"] };
    const refused = { ...base, terminal: "error: 500", perfect: false, average: 0, tools: [] };
    expect(summary([good, refused])).toMatchObject({ runs: 1, perfect: 1, perfectRate: 1, rubricAverage: 1, medianToolCalls: 2, medianStepsPerReference: 1 });
    expect(line(good)).toContain("PERFECT easy abc rubric 1.00");
  });
});
