import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { JudgeConfig } from "../judge-config.ts";
import { buildJudgeRequest, parseJudgeReply, withoutKey } from "../judge-request.ts";
import { actionHistory, judgeTask, parseVerdict, rubricMessage, system } from "../judge.ts";
import type { Step } from "../recorder.ts";
import type { OdysseysTask } from "../tasks.ts";
import { sendJson, startMock, type Mock } from "./mock.ts";

const dir = mkdtempSync(join(tmpdir(), "odysseys-judge-"));
const png = join(dir, "shot-001.png");
const jpg = join(dir, "shot-002.jpg");
writeFileSync(png, Buffer.from("png-bytes"));
writeFileSync(jpg, Buffer.from("jpg-bytes"));
const pngData = Buffer.from("png-bytes").toString("base64");
const jpgData = Buffer.from("jpg-bytes").toString("base64");

const task: OdysseysTask = {
  id: "task-1", prompt: " Find a hotel. ", startUrl: "https://www.google.com", level: "easy", referenceLength: 5, split: "dev",
  rubrics: [
    { id: "R1", requirement: " Has a hotel ", verification: " Screenshot shows it " },
    { id: "R2", requirement: "Has a price", verification: "  " },
  ],
};
const steps: Step[] = [
  { step: 1, action: "browser_run", response: " opened hotels ", screenshots: [] },
  { step: 2, action: "final_answer", response: "", screenshots: [] },
];
const config = (provider: JudgeConfig["provider"], baseUrl = "https://example.test"): JudgeConfig =>
  ({ provider, model: `${provider}/m`, providerModel: "m", key: "secret-judge-key", baseUrl });
const input = { system: "sys", text: "txt", images: [png, jpg], maxOutputTokens: 16_000 };

let mock: Mock | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});
const noWait = async () => undefined;

describe("what scores depend on stays still", () => {
  it("keeps the official judge's system prompt, byte for byte", () => {
    expect(createHash("sha256").update(system).digest("hex")).toBe("4c3bfd5b364ddda1c101cdbc3d9b7751004e12288804d149cc4891419c0b7346");
  });

  it("builds the action history as the original does", () => {
    expect(actionHistory(steps)).toBe("1. Response: opened hotels\nAction: browser_run\n2. Action: final_answer");
    expect(actionHistory([])).toBe("No actions recorded.");
  });

  it("builds the rubric message as the original does", () => {
    expect(rubricMessage(task, task.rubrics[0]!, "HISTORY", 2, 7)).toBe(
      "User Task (context only): Find a hotel.\n\nEvaluate ONLY this rubric item:\nRubric ID: R1\nRequirement: Has a hotel\nVerification: Screenshot shows it" +
      "\n\nFull Action History:\nHISTORY\n\nScreenshots attached below: 2 (trajectory had 7 total step(s))." +
      "\n\nDecide whether the rubric (R1) is satisfied. Use the required 'Thoughts:' / 'Status:' format.",
    );
    expect(rubricMessage(task, task.rubrics[1]!, "H", 0, 0)).not.toContain("Verification:");
  });

  it("parses verdicts as the original does", () => {
    expect(parseVerdict('Thoughts: looks right\nStatus: "success"')).toEqual({ verdict: true, success: true, reasoning: "looks right" });
    expect(parseVerdict("Thoughts: no\nStatus: failure")).toEqual({ verdict: true, success: false, reasoning: "no" });
    expect(parseVerdict("STATUS: 'Success'").success).toBe(true);
    expect(parseVerdict("I think it passed")).toMatchObject({ verdict: false, success: false, reasoning: "I think it passed" });
  });
});

describe("the request for each provider", () => {
  it("speaks Anthropic's format", () => {
    const request = buildJudgeRequest(config("anthropic"), input);
    expect(request.url).toBe("https://example.test/v1/messages");
    expect(request.headers).toMatchObject({ "x-api-key": "secret-judge-key", "anthropic-version": "2023-06-01" });
    expect(request.body).toEqual({
      model: "m", max_tokens: 16_000, system: "sys",
      messages: [{ role: "user", content: [
        { type: "text", text: "txt" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: pngData } },
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpgData } },
      ] }],
    });
  });

  it("speaks Google's format, with the key out of the address", () => {
    const request = buildJudgeRequest(config("google"), input);
    expect(request.url).toBe("https://example.test/v1beta/models/m:generateContent");
    expect(request.url).not.toContain("secret-judge-key");
    expect(request.headers["x-goog-api-key"]).toBe("secret-judge-key");
    expect(request.body).toEqual({
      systemInstruction: { parts: [{ text: "sys" }] },
      contents: [{ role: "user", parts: [
        { text: "txt" },
        { inlineData: { mimeType: "image/png", data: pngData } },
        { inlineData: { mimeType: "image/jpeg", data: jpgData } },
      ] }],
      generationConfig: { maxOutputTokens: 16_000 },
    });
  });

  it("speaks the OpenAI-compatible format", () => {
    const request = buildJudgeRequest(config("openai-compatible", "https://example.test/v1/"), input);
    expect(request.url).toBe("https://example.test/v1/chat/completions");
    expect(request.headers.authorization).toBe("Bearer secret-judge-key");
    expect(request.body).toEqual({
      model: "m", max_tokens: 16_000,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: [
          { type: "text", text: "txt" },
          { type: "image_url", image_url: { url: `data:image/png;base64,${pngData}` } },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpgData}` } },
        ] },
      ],
    });
    expect(buildJudgeRequest(config("openai"), input).body).toMatchObject({ max_completion_tokens: 16_000 });
  });

  it("reads each provider's reply", () => {
    expect(parseJudgeReply(config("anthropic"), { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }], usage: { input_tokens: 3, output_tokens: 4 } })).toEqual({ text: "ab", inputTokens: 3, outputTokens: 4 });
    expect(parseJudgeReply(config("google"), { candidates: [{ content: { parts: [{ text: "hidden", thought: true }, { text: "c" }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 6 } })).toEqual({ text: "c", inputTokens: 5, outputTokens: 6 });
    expect(parseJudgeReply(config("openai-compatible"), { choices: [{ message: { content: "d" } }], usage: { prompt_tokens: 7, completion_tokens: 8 } })).toEqual({ text: "d", inputTokens: 7, outputTokens: 8 });
    expect(parseJudgeReply(config("openai-compatible"), {}).text).toBe("");
  });

  it("scrubs the key from failure text", () => {
    expect(withoutKey("bad key secret-judge-key here", "secret-judge-key")).toBe("bad key [key] here");
  });
});

describe("judging a task against a local mock", () => {
  const options = { maxImages: 60, lanes: 2, wait: noWait };
  const reply = (text: string) => ({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
  const judgeAt = (url: string) => config("openai-compatible", `${url}/v1`);

  it("asks once per rubric with the prompt and pictures, and scores the verdicts", async () => {
    mock = await startMock((request, response) =>
      sendJson(response, 200, reply(request.body.includes("Rubric ID: R1") ? 'Thoughts: yes\nStatus: "success"' : 'Thoughts: no\nStatus: "failure"')));
    const verdict = await judgeTask(judgeAt(mock.url), task, steps, [png, jpg], options);
    expect(mock.seen).toHaveLength(2);
    expect(mock.seen.every((item) => item.method === "POST" && item.path === "/v1/chat/completions")).toBe(true);
    expect(mock.seen[0]!.headers.authorization).toBe("Bearer secret-judge-key");
    const body = JSON.parse(mock.seen[0]!.body) as { messages: Array<{ role: string; content: unknown }> };
    expect(body.messages[0]).toEqual({ role: "system", content: system });
    expect((body.messages[1]!.content as unknown[]).length).toBe(3);
    expect(verdict).toEqual({
      rubrics: [{ id: "R1", success: true, reasoning: "yes" }, { id: "R2", success: false, reasoning: "no" }],
      average: 0.5, perfect: false, inputTokens: 20, outputTokens: 4,
    });
  });

  it("sends only the last pictures past the cap", async () => {
    mock = await startMock((_request, response) => sendJson(response, 200, reply("Status: success")));
    const verdict = await judgeTask(judgeAt(mock.url), { ...task, rubrics: [task.rubrics[0]!] }, steps, [png, jpg], { ...options, maxImages: 1 });
    expect(verdict.perfect).toBe(true);
    expect(mock.seen[0]!.body).toContain(jpgData);
    expect(mock.seen[0]!.body).not.toContain(pngData);
    expect(mock.seen[0]!.body).toContain("Screenshots attached below: 1");
  });

  it("waits out a rate limit or an outage and asks again", async () => {
    const waits: number[] = [];
    mock = await startMock((_request, response) => {
      if (mock!.seen.length === 1) return sendJson(response, 429, { error: "rate limit" });
      if (mock!.seen.length === 2) return sendJson(response, 503, { error: "overloaded" });
      sendJson(response, 200, reply("Status: success"));
    });
    const verdict = await judgeTask(judgeAt(mock.url), { ...task, rubrics: [task.rubrics[0]!] }, steps, [], { ...options, wait: async (ms) => void waits.push(ms) });
    expect(verdict.perfect).toBe(true);
    expect(mock.seen).toHaveLength(3);
    expect(waits).toEqual([30_000, 60_000]);
  });

  it("asks again when a reply has no verdict, then marks it as the judge's failure", async () => {
    mock = await startMock((_request, response) => sendJson(response, 200, reply("")));
    const verdict = await judgeTask(judgeAt(mock.url), { ...task, rubrics: [task.rubrics[0]!] }, steps, [], options);
    expect(mock.seen).toHaveLength(3);
    expect(verdict.rubrics[0]).toMatchObject({ success: false, judgeError: true });
    expect(verdict.perfect).toBe(false);
  });

  it("doesn't retry a refused key, and keeps the key out of the result", async () => {
    mock = await startMock((_request, response) => sendJson(response, 401, { error: "bad key secret-judge-key" }));
    const verdict = await judgeTask(judgeAt(mock.url), { ...task, rubrics: [task.rubrics[0]!] }, steps, [], options);
    expect(mock.seen).toHaveLength(1);
    expect(verdict.rubrics[0]).toMatchObject({ success: false, judgeError: true });
    expect(verdict.rubrics[0]!.reasoning).toContain("judge 401");
    expect(JSON.stringify(verdict)).not.toContain("secret-judge-key");
  });

  it("asks again when a call goes quiet", async () => {
    mock = await startMock((_request, response) => {
      if (mock!.seen.length === 1) return; // Never answers.
      sendJson(response, 200, reply("Status: failure"));
    });
    const verdict = await judgeTask(judgeAt(mock.url), { ...task, rubrics: [task.rubrics[0]!] }, steps, [], { ...options, quietMs: 50 });
    expect(mock.seen).toHaveLength(2);
    expect(verdict.rubrics[0]).toEqual({ id: "R1", success: false, reasoning: "Status: failure" });
  });

  it("speaks to Anthropic's and Google's paths on a mock too", async () => {
    mock = await startMock((request, response) => {
      if (request.path === "/v1/messages") return sendJson(response, 200, { content: [{ type: "text", text: "Status: success" }], usage: { input_tokens: 1, output_tokens: 1 } });
      sendJson(response, 200, { candidates: [{ content: { parts: [{ text: "Status: success" }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } });
    });
    const one = { ...task, rubrics: [task.rubrics[0]!] };
    expect((await judgeTask(config("anthropic", mock.url), one, steps, [], options)).perfect).toBe(true);
    expect((await judgeTask(config("google", mock.url), one, steps, [], options)).perfect).toBe(true);
    expect(mock.seen.map((item) => item.path)).toEqual(["/v1/messages", "/v1beta/models/m:generateContent"]);
  });
});
