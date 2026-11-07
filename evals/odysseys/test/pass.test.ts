// A whole pass through the real entry point, with the stack, the bridge and the judge all local
// mocks. It proves the runner's wiring, not that Misty's agent works.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
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
  models?: () => Record<string, string> | null;
}

async function world({ models = () => ({ agent: "anthropic/agent-model", fast: "anthropic/fast-model" }) }: Options = {}) {
  let invocations = 0;
  const bridge = await startMock((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) return sendJson(response, 401, {});
    if (request.path === "/models") return sendJson(response, 200, { ok: true, result: { models: models(), reasoning: "low", search: "serper" } });
    if (request.path === "/window-eval") {
      const { script: code } = JSON.parse(request.body) as { script: string };
      if (code.includes("createInvocation")) {
        const id = `invocation_${++invocations}`;
        return sendJson(response, 200, { ok: true, result: { invocationId: id, conversationId: `conversation_${invocations}` } });
      }
      if (code.includes("desktopDeviceGrants")) return sendJson(response, 200, { ok: true, result: [{ runGrant: { signed: true } }] });
      return sendJson(response, 200, { ok: true, result: { agentId: "agent_1", deviceId: "device_1" } });
    }
    const { runId } = (request.body ? JSON.parse(request.body) : {}) as { runId?: string };
    if (request.path === "/run-follow")
      return sendJson(response, 200, {
        ok: true,
        result: {
          state: "completed",
          events: [
            { type: "eval.ignored" },
            { type: "tool.started", toolCallId: `${runId}-call`, toolName: "browser.run" },
            { type: "tool.completed", toolCallId: `${runId}-call`, toolName: "browser_run" },
            { type: "response.delta", delta: "My answer." },
            { type: "invocation.completed" },
          ],
        },
      });
    if (request.path === "/run-record")
      return sendJson(response, 200, { ok: true, result: [{ tool_call_id: `${runId}-call`, tool_name: "browser.run", output: { url: "https://shop.test", title: "Shop" } }] });
    if (request.path === "/pages") return sendJson(response, 200, { ok: true, result: { pages: [{ label: "misty-browser-a", url: "https://shop.test", runId: `invocation_${invocations}` }] } });
    if (request.path === "/capture") return sendJson(response, 200, { ok: true, result: { dataUrl: image } });
    if (request.path === "/processes") return sendJson(response, 200, { ok: true, result: { webProcesses: [1], views: [] } });
    sendJson(response, 404, { ok: false });
  });
  const judge = await startMock((_request, response) =>
    sendJson(response, 200, { choices: [{ message: { content: 'Thoughts: fine\nStatus: "success"' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }));
  mocks = [bridge, judge];
  const dir = mkdtempSync(join(tmpdir(), "odysseys-pass-"));
  const env = {
    PATH: process.env.PATH,
    MISTY_BROWSER_EVAL_BRIDGE: bridge.url,
    MISTY_BROWSER_EVAL_BRIDGE_TOKEN: token,
    MISTY_ODYSSEYS_JUDGE_MODEL: "vendor/judge",
    MISTY_ODYSSEYS_JUDGE_KEY: key,
    MISTY_ODYSSEYS_JUDGE_BASE_URL: `${judge.url}/v1`,
    MISTY_ODYSSEYS_TASKS: "46ecc9a5dc,8f005e9f09",
    MISTY_ODYSSEYS_REPORTS: join(dir, "reports"),
  };
  return { bridge, judge, dir, env };
}

const pass = async (env: Record<string, string | undefined>) => {
  const { stderr } = await exec(process.execPath, [script("run.ts")], { env, timeout: 30_000 });
  return stderr;
};
const folders = (dir: string) => readdirSync(join(dir, "reports")).map((name) => join(dir, "reports", name));
const reportOf = (folder: string) => JSON.parse(readFileSync(join(folder, "report.json"), "utf8")) as PassReport;

describe("a whole pass", () => {
  it("runs the tasks, records the pass, and two passes compare", async () => {
    const { dir, env, bridge, judge } = await world();
    await pass(env);
    await pass(env);

    const [first, second] = folders(dir);
    const report = reportOf(first!);
    expect(report.stopped).toBe("");
    expect(report.runtime).toBe("rust");
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
    const started = bridge.seen.find((item) => item.path === "/window-eval" && item.body.includes("createInvocation"))!;
    const { script: code } = JSON.parse(started.body) as { script: string };
    expect(code).toContain('"evalTurnLimit":100');
    expect(code).not.toMatch(/"(modelId|model_id)"/);

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

  it("refuses to start with no agent model on the device", async () => {
    const { env, bridge } = await world({ models: () => null });
    await expect(pass(env)).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("no usable agent model") });
    expect(bridge.seen.some((item) => item.body.includes("createInvocation"))).toBe(false);
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
