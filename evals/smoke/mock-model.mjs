// A scripted OpenAI-compatible model on this computer, for the smoke test. It answers what it's told
// to and records every request as it arrived, so a test can read what the runtime really sent.
//
//   POST /__script {steps: [...]}   Queues replies for run turns (calls that offer agent_finish)
//   GET  /__log?since=N             The requests received from N on, raw body included
//   GET  /__held                    How many replies are being held
//   POST /__release                 Lets every held reply go
//   POST /__reset                   Clears the queue and the log
//   GET  /__slow-page?name=N        A page that takes a while, so tabs can be seen overlapping
//   GET  /__slow-pages              The most slow pages being served at once, and how many were asked for
//
// A step is {text}, {tools: [{name, args, id?}]}, or either with hold: true, which waits for
// /__release before answering. Everything else, such as titles and checks, gets a short text reply.
import { createServer } from "node:http";

const log = [];
let script = [];
let held = [];
let callNumber = 0;

const reply = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const readBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });

const toolNames = (body) => (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name);
const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };

/** The two checks Settings › Models runs, which any model that can read would pass. */
function modelCheckStep(body) {
  const names = toolNames(body);
  const last = body.messages?.at(-1);
  if (names.includes("stock"))
    return last?.role === "tool"
      ? { text: "The North store has 37 units." }
      : { tools: [{ name: "stock", args: { store: "North", product: "blue kettle" } }] };
  if (names.includes("browser_visual") && JSON.stringify(body.messages ?? []).includes("single color"))
    return { text: "red" };
  return null;
}

function nextStep(body) {
  const check = modelCheckStep(body);
  if (check) return check;
  // A spoken turn asks for its answer as JSON.
  if (body.response_format && /conversational companion/.test(body.messages?.[0]?.content ?? ""))
    return { text: JSON.stringify({ say: "Hello from the mock voice.", tool: "", instruction: "" }) };
  if (toolNames(body).includes("agent_finish")) return script.shift() ?? { text: "The script is empty." };
  return { text: "Smoke reply" };
}

function toolCalls(step) {
  return (step.tools ?? []).map((tool, index) => ({
    index,
    id: tool.id ?? `call_mock_${++callNumber}`,
    type: "function",
    function: { name: tool.name, arguments: JSON.stringify(tool.args ?? {}) },
  }));
}

function answerWhole(response, body, step) {
  const calls = toolCalls(step);
  reply(response, 200, {
    id: `cmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices: [
      {
        index: 0,
        finish_reason: calls.length ? "tool_calls" : "stop",
        message: {
          role: "assistant",
          content: step.text ?? null,
          ...(calls.length ? { tool_calls: calls } : {}),
        },
      },
    ],
    usage,
  });
}

function answerStream(response, body, step) {
  const calls = toolCalls(step);
  const chunk = (delta, finish = null, extra = {}) =>
    `data: ${JSON.stringify({
      id: `cmpl-${Date.now()}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      choices: [{ index: 0, delta, finish_reason: finish }],
      ...extra,
    })}\n\n`;
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  response.write(chunk({ role: "assistant", content: "" }));
  if (step.text) response.write(chunk({ content: step.text }));
  for (const call of calls) response.write(chunk({ tool_calls: [call] }));
  response.write(chunk({}, calls.length ? "tool_calls" : "stop", { usage }));
  response.end("data: [DONE]\n\n");
}

async function chat(request, response) {
  const raw = await readBody(request);
  const body = JSON.parse(raw);
  const step = nextStep(body);
  log.push({
    at: new Date().toISOString(),
    path: request.url,
    model: body.model,
    hasKey: (request.headers.authorization ?? "").startsWith("Bearer "),
    tools: toolNames(body),
    step,
    raw,
  });
  if (step.hold) {
    await new Promise((release) => {
      held.push(release);
      // A client that went away isn't waiting any more.
      response.on("close", () => {
        held = held.filter((waiting) => waiting !== release);
        release();
      });
    });
  }
  if (response.destroyed || response.closed) return;
  if (body.stream) answerStream(response, body, step);
  else answerWhole(response, body, step);
}

const slowPages = { serving: 0, mostAtOnce: 0, served: 0 };
const servePage = async (response, name) => {
  slowPages.served += 1;
  slowPages.serving += 1;
  slowPages.mostAtOnce = Math.max(slowPages.mostAtOnce, slowPages.serving);
  await new Promise((done) => setTimeout(done, 1500));
  slowPages.serving -= 1;
  response.writeHead(200, { "content-type": "text/html" });
  response.end(`<!doctype html><title>Page ${name}</title><h1>Slow page ${name}</h1>`);
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/__slow-page") return await servePage(response, url.searchParams.get("name"));
    if (url.pathname === "/__slow-pages") return reply(response, 200, slowPages);
    if (url.pathname === "/__script") {
      const { steps } = JSON.parse(await readBody(request));
      script = [...script, ...steps];
      return reply(response, 200, { queued: script.length });
    }
    if (url.pathname === "/__log") {
      const since = Number(url.searchParams.get("since") ?? 0);
      return reply(response, 200, { total: log.length, requests: log.slice(since) });
    }
    if (url.pathname === "/__held") return reply(response, 200, { held: held.length, queued: script.length });
    if (url.pathname === "/__release") {
      const waiting = held;
      held = [];
      waiting.forEach((release) => release());
      return reply(response, 200, { released: waiting.length });
    }
    if (url.pathname === "/__reset") {
      script = [];
      log.length = 0;
      return reply(response, 200, {});
    }
    if (url.pathname.endsWith("/models")) {
      return reply(response, 200, {
        object: "list",
        data: [
          { id: "mock-agent", object: "model" },
          { id: "mock-fast", object: "model" },
          { id: "mock-embedding", object: "model" },
        ],
      });
    }
    if (url.pathname.endsWith("/chat/completions")) return await chat(request, response);
    if (url.pathname.endsWith("/embeddings")) {
      const body = JSON.parse(await readBody(request));
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return reply(response, 200, {
        object: "list",
        model: body.model,
        data: inputs.map((_, index) => ({ object: "embedding", index, embedding: Array(768).fill(0.01) })),
        usage: { prompt_tokens: 1, total_tokens: 1 },
      });
    }
    return reply(response, 404, { error: { message: `No mock for ${url.pathname}` } });
  } catch (error) {
    return reply(response, 500, { error: { message: String(error) } });
  }
});

const port = Number(process.env.MISTY_SMOKE_MOCK_PORT ?? 18098);
server.listen(port, "127.0.0.1", () => console.log(`Mock model on http://127.0.0.1:${port}/v1`));
