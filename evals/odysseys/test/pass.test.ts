// A whole pass through the real entry point, with the stack, the bridge and the judge all local
// mocks. It proves the runner's wiring, not that Misty's agent works.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { PassReport } from "../report.ts";
import { sendJson, startMock, type Mock } from "./mock.ts";

const exec = promisify(execFile);
const script = (name: string) => resolve(import.meta.dirname, "..", name);
const image = `data:image/jpeg;base64,${Buffer.from("picture").toString("base64")}`;
const key = "secret-judge-key";
const token = "a-token-of-twenty-four-characters";

let mocks: Mock[] = [];
afterEach(async () => {
  await Promise.all(mocks.map((mock) => mock.close()));
  mocks = [];
});

interface Options {
  turns?: number;
  models?: () => Record<string, string> | null;
}

async function world({ turns = 100, models = () => ({ agent: "anthropic/agent-model", fast: "anthropic/fast-model" }) }: Options = {}) {
  const app = { runtime: "typescript" };
  let invocations = 0;
  const stack = await startMock((request, response) => {
    if (request.path === "/login") return sendJson(response, 200, {}, { "set-cookie": "misty_session=abc; Path=/" });
    if (request.path === "/me") return sendJson(response, 200, { id: "user_1" });
    if (request.path === "/misty/agents") return sendJson(response, 200, { agents: [{ id: "agent_1" }] });
    if (request.path === "/devices") return sendJson(response, 200, { devices: [{ id: "device_1" }] });
    if (request.path === "/ai/invocations") {
      const id = `invocation_${++invocations}`;
      return sendJson(response, 202, { invocationId: id, conversationId: `conversation_${invocations}`, eventsUrl: `/ai/invocations/${id}/events`, modelTurnLimit: turns });
    }
    if (request.path.endsWith("/events")) {
      const id = request.path.split("/").at(-2)!;
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [
        { type: "eval.ignored" },
        { type: "tool.started", toolCallId: `${id}-call`, toolName: "browser.run" },
        { type: "tool.completed", toolCallId: `${id}-call`, toolName: "browser_run" },
        { type: "response.delta", delta: "My answer." },
        { type: "invocation.completed" },
      ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
      return void response.end();
    }
    if (request.path.endsWith("/tool-output")) {
      const id = request.path.split("/").at(-2)!;
      return sendJson(response, 200, { items: [{ tool_call_id: `${id}-call`, tool_name: "browser.run", output: { url: "https://shop.test", title: "Shop" } }] });
    }
    sendJson(response, 404, {});
  });
  const bridge = await startMock((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) return sendJson(response, 401, {});
    if (request.path === "/models") return sendJson(response, 200, { ok: true, result: { models: models(), reasoning: "low", search: "serper", runtime: app.runtime } });
    if (request.path === "/run-grants") return sendJson(response, 200, { ok: true, result: [{ signed: true }] });
    if (request.path === "/pages") return sendJson(response, 200, { ok: true, result: { pages: [{ label: "misty-browser-a", url: "https://shop.test", runId: `invocation_${invocations}` }] } });
    if (request.path === "/capture") return sendJson(response, 200, { ok: true, result: { dataUrl: image } });
    if (request.path === "/processes") return sendJson(response, 200, { ok: true, result: { webProcesses: [1], views: [] } });
    sendJson(response, 404, { ok: false });
  });
  const judge = await startMock((_request, response) =>
    sendJson(response, 200, { choices: [{ message: { content: 'Thoughts: fine\nStatus: "success"' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }));
  mocks = [stack, bridge, judge];
  const dir = mkdtempSync(join(tmpdir(), "odysseys-pass-"));
  const signIn = join(dir, "signin.json");
  writeFileSync(signIn, JSON.stringify({ email: "test@example.test", password: "not-real" }));
  const env = {
    PATH: process.env.PATH,
    MISTY_ODYSSEYS_API: stack.url,
    MISTY_ODYSSEYS_SIGNIN: signIn,
    MISTY_BROWSER_EVAL_BRIDGE: bridge.url,
    MISTY_BROWSER_EVAL_BRIDGE_TOKEN: token,
    MISTY_ODYSSEYS_RUNTIME: "typescript",
    MISTY_ODYSSEYS_JUDGE_MODEL: "vendor/judge",
    MISTY_ODYSSEYS_JUDGE_KEY: key,
    MISTY_ODYSSEYS_JUDGE_BASE_URL: `${judge.url}/v1`,
    MISTY_ODYSSEYS_TASKS: "46ecc9a5dc,8f005e9f09",
    MISTY_ODYSSEYS_REPORTS: join(dir, "reports"),
  };
  return { stack, bridge, judge, dir, env, app };
}

const pass = async (env: Record<string, string | undefined>) => {
  const { stderr } = await exec(process.execPath, [script("run.ts")], { env, timeout: 30_000 });
  return stderr;
};
const folders = (dir: string) => readdirSync(join(dir, "reports")).map((name) => join(dir, "reports", name));
const reportOf = (folder: string) => JSON.parse(readFileSync(join(folder, "report.json"), "utf8")) as PassReport;

describe("a whole pass", () => {
  it("runs the tasks, records the pass, and two passes compare", async () => {
    const { dir, env, stack, judge, app } = await world();
    await pass(env);
    app.runtime = "rust";
    await pass({ ...env, MISTY_ODYSSEYS_RUNTIME: "rust" });

    const [first, second] = folders(dir);
    const report = reportOf(first!);
    expect(report.stopped).toBe("");
    expect(report.runtime).toBe("typescript");
    expect(report.device).toEqual({ models: { agent: "anthropic/agent-model", fast: "anthropic/fast-model" }, reasoning: "low", search: "serper" });
    expect(report.turnLimit).toBe(100);
    expect(report.taskIds.map((id) => id.slice(0, 10)).sort()).toEqual(["46ecc9a5dc", "8f005e9f09"]);
    expect(report.judge).toMatchObject({ model: "vendor/judge", provider: "openai-compatible", maxImages: 60 });
    expect(report.commit.misty?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(report.dataSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.summary).toMatchObject({ runs: 2, perfect: 2, rubricAverage: 1 });
    expect(report.runs[0]).toMatchObject({ terminal: "invocation.completed", perfect: true, tools: ["browser_run"], judgeErrors: 0, answer: "My answer." });
    expect(report.runs[0]!.conversationId).toMatch(/^conversation_/);

    // The product path: a composer request naming the turn limit and no model.
    const body = JSON.parse(stack.seen.find((item) => item.path === "/ai/invocations")!.body) as Record<string, unknown>;
    expect(body.eval_turn_limit).toBe(100);
    expect(Object.keys(body).filter((name) => /model/.test(name))).toEqual([]);

    // The judge saw the recorded step and picture.
    expect(judge.seen[0]!.body).toContain("Response: https://shop.test | Shop");
    expect(judge.seen[0]!.body).toContain("Screenshots attached below: ");
    expect(judge.seen[0]!.body).toContain(Buffer.from("picture").toString("base64"));

    // A step per call, and the judge's key nowhere on disk.
    const task = join(first!, report.runs[0]!.taskId.slice(0, 10));
    expect(readFileSync(join(task, "steps.jsonl"), "utf8")).toContain('"action":"browser_run"');
    expect(existsSync(join(task, "result.json"))).toBe(true);
    expect(readFileSync(join(first!, "report.json"), "utf8")).not.toContain(key);
    expect(readFileSync(join(task, "result.json"), "utf8")).not.toContain(key);

    const compared = await exec(process.execPath, [script("compare-cli.ts"), first!, second!]);
    expect(compared.stdout).toContain("Candidate: rust");
    expect(compared.stdout).toContain("Same or better: yes");
  }, 60_000);

  it("stops at once when the server didn't honor the turn limit, and the report says so", async () => {
    const { dir, env } = await world({ turns: 20 });
    const stderr = await pass(env);
    expect(stderr).toContain("gave this run 20 turns, not 100");
    expect(reportOf(folders(dir)[0]!).stopped).toContain("gave this run 20 turns");
    expect(reportOf(folders(dir)[0]!).runs).toEqual([]);
  }, 60_000);

  it("refuses a pass labelled with a runtime the app isn't on", async () => {
    const { env, app } = await world();
    app.runtime = "rust";
    await expect(pass(env)).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("the app is on rust") });
  }, 60_000);

  it("refuses to start with no agent model on the device", async () => {
    const { env, stack } = await world({ models: () => null });
    await expect(pass(env)).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("no usable agent model") });
    expect(stack.seen.some((item) => item.path === "/ai/invocations")).toBe(false);
  }, 60_000);

  it("marks a pass whose model changed on the device, so it can't be compared", async () => {
    let reads = 0;
    const { dir, env } = await world({ models: () => ({ agent: ++reads > 1 ? "anthropic/other" : "anthropic/agent-model" }) });
    const stderr = await pass({ ...env, MISTY_ODYSSEYS_TASKS: "46ecc9a5dc" });
    expect(stderr).toContain("model settings changed");
    expect(reportOf(folders(dir)[0]!).stopped).toContain("model settings changed");
  }, 60_000);

  it("judges a saved run again and brings the pass's report up to date", async () => {
    const { dir, env, judge } = await world();
    await pass({ ...env, MISTY_ODYSSEYS_TASKS: "46ecc9a5dc" });
    const folder = folders(dir)[0]!;
    const report = reportOf(folder);
    const task = join(folder, report.runs[0]!.taskId.slice(0, 10));
    const before = judge.seen.length;
    await exec(process.execPath, [script("regrade.ts"), task], { env });
    expect(judge.seen.length).toBe(before * 2);
    expect(reportOf(folder).runs[0]!.judgeInputTokens).toBe(report.runs[0]!.judgeInputTokens * 2);
    await expect(exec(process.execPath, [script("regrade.ts"), task], { env: { ...env, MISTY_ODYSSEYS_JUDGE_MODEL: "vendor/other" } })).rejects.toMatchObject({ stderr: expect.stringContaining("graded by vendor/judge") });
  }, 60_000);
});
