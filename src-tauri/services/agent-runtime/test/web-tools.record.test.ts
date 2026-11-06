import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, it, vi } from "vitest";
import { runBrowserReplay } from "../src/browser-replay.js";
import { companionImageParts } from "../src/companion-images.js";
import { setDeviceModels } from "../src/device-models.js";
import { initialMessages } from "../src/model-input.js";
import { modelCatalog, visualToolOutput } from "../src/model-tools.js";
import { proofTabsRefusal } from "../src/proof-tabs.js";
import { classifyRuntimeError, visibleErrorMessage } from "../src/runtime-errors.js";
import { serialToolLifecycle } from "../src/serial-tool-lifecycle.js";
import { toolMonitor } from "../src/tool-monitor.js";
import { classifyToolOutcome, executionInstructions, incompleteToolResultText, unconfirmedToolResultReason, unfinishedModelResult } from "../src/tool-outcomes.js";
import { agentTools } from "../src/toolsets.js";
import { billingNote, browserNote, readablePage } from "../src/web-fetch/readable.js";
import { webFetchDescriptor } from "../src/web-fetch/tool.js";
import { deviceWebSearch } from "../src/web-search/search-step.js";
import { deviceToolActivity, webSearchDescriptor } from "../src/web-search/tool.js";

/**
 * Records what the TypeScript makes of the fixture pages and which words it gives the model, for the
 * Rust crate's parity tests (`src-tauri/crates/agent/src/runtime/web_fetch/readable_tests.rs` and
 * `tools_parity_tests.rs`). It reaches no network. Run it after changing a page or a case:
 *
 *   MISTY_RECORD_WEB_TOOLS=1 npx vitest run test/web-tools.record.test.ts
 */
const recording = process.env.MISTY_RECORD_WEB_TOOLS === "1";
const fixtures = resolve(import.meta.dirname, "../../../crates/agent/tests/fixtures");

const write = (path: string, value: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`);
};

const longQuestions = [
  { page: "long-article.html", question: "what does the business plan cost per user", limit: 15_000 },
  { page: "long-article.html", question: "what does the business plan cost per user", limit: 2_000 },
  { page: "long-article.html", question: "zebra quartz nothing matches", limit: 2_000 },
  { page: "long-article.html", question: "", limit: 2_000 },
  { page: "long-article.html", question: "the", limit: 500 },
  { page: "long-article.html", question: "préférences 日本語 emoji", limit: 3_000 },
  { page: "unicode.html", question: "", limit: 7 },
  { page: "unicode.html", question: "", limit: 40 },
];
const contentTypes = [
  { page: "plain.txt", contentType: "text/plain" },
  { page: "data.json", contentType: "application/json" },
  { page: "plain.txt", contentType: "" },
  { page: "pricing.html", contentType: "application/xhtml+xml" },
  { page: "pricing.html", contentType: "text/xml; charset=utf-8" },
  { page: "pricing.html", contentType: "" },
  { page: "pricing.html", contentType: "text/plain" },
];

describe.runIf(recording)("web tool fixtures", () => {
  afterAll(() => {
    vi.unstubAllGlobals();
    setDeviceModels(null);
  });

  it("records each page's readable text", () => {
    const folder = join(fixtures, "web_fetch/pages");
    const htmlPages = readdirSync(folder).filter((name) => name.endsWith(".html")).sort();
    const cases = [
      ...htmlPages.map((page) => ({ page, contentType: "text/html", question: "", limit: 15_000 })),
      ...longQuestions.map((item) => ({ contentType: "text/html", ...item })),
      ...contentTypes.map((item) => ({ question: "", limit: 15_000, ...item })),
    ];
    write(join(fixtures, "web_fetch/readable.json"), cases.map((item) => {
      const html = readFileSync(join(folder, item.page)).toString("utf8");
      try {
        return { ...item, result: readablePage(html, item.contentType, item.question, item.limit) };
      } catch {
        return { ...item, result: null };
      }
    }));
  });

  it("records the words the model reads", async () => {
    const schema = { type: "object", properties: {} };
    const catalogOf = (names: string[]) => modelCatalog(names.map((name) => ({ name, description: name, inputSchema: schema })), ["agent_finish", "agent_tool_use", "agent_tool_load"]);
    const toolsets = (names: string[], request = "") => {
      const made = agentTools(catalogOf(names), request);
      return {
        names, request, initial: made.initial, instructions: made.instructions,
        tools: Object.entries(made.tools).map(([name, tool]) => ({ name, description: tool.description, inputSchema: (tool.inputSchema as { jsonSchema: unknown }).jsonSchema })),
      };
    };

    const capture = { id: "c1", mime_type: "image/png" as const, data_url: "data:image/png;base64,AA==", width: 1280, height: 800.5, content_hash: "abc" };
    const parts = companionImageParts([
      { ...capture, name: "screen1 — primary (Code: main.rs) (1280 × 800)", screen: "screen1", primary: true, captured_at: Date.UTC(2026, 8, 27, 1, 2, 3, 4) },
      { ...capture, name: "screen2 (1280 × 800)", screen: "screen2", primary: false },
      { ...capture, name: "window1 — Code: \"main\".rs (1280 × 800)", screen: "window1", primary: false, source: "desktop-window" },
      { ...capture, name: "plain", screen: "focus1", primary: true },
      { ...capture, name: "screen3 — primary (cursor) (1 × 1)", screen: "screen3", primary: true, controls: [{ label: "Back \"up\"", role: "button", x: 10, y: 20.5, width: 30, height: 40, reveal: "hover" }, { label: "Go", role: "link", x: 1, y: 2, width: 3, height: 4 }] },
    ]);

    const attachment = (id: string, name: string, mime: "text/plain" | "application/pdf" | "image/png", url: string) => ({ id, name, mime_type: mime, data_url: url, width: 4, height: 3, content_hash: "h" });
    const input = initialMessages({
      prompt: "Go", system: "", model_id: "m", allowed_tools: [],
      attachments: [
        attachment("a1", "notes \"1\".txt", "text/plain", `data:text/plain;base64,${Buffer.from("héllo 😀").toString("base64")}`),
        attachment("a2", "plan.pdf", "application/pdf", "data:application/pdf;base64,JVBERg=="),
        attachment("a3", "shot.png", "image/png", "data:image/png;base64,AAAA"),
      ],
      capture: { ...capture, name: "screen" },
      display_captures: [{ ...capture, name: "screen1 (1 × 1)", screen: "screen1", primary: false }],
    });

    const monitorWords = async (name: string, end: { success: boolean; output?: unknown; error?: unknown }, callInput: unknown = {}, rejected = false) => {
      const order = serialToolLifecycle();
      const monitor = toolMonitor({
        catalog: modelCatalog([{ name, description: "", inputSchema: schema }], ["agent_finish"]), order, rejected: new Set(rejected ? ["a"] : []),
        checkpoint: async () => {},
      });
      const toolCall = { toolCallId: "a", toolName: name.replaceAll(".", "_"), input: callInput };
      await monitor.onStart({ toolCall });
      await monitor.onEnd({ toolCall, durationMs: 1, ...end });
      await order.start("b", async () => {});
      return { stopped: order.stoppedReason, declined: order.declined("b"), failures: monitor.failures() };
    };

    const replayed = await runBrowserReplay(
      { scope_id: "scope-12345678", calls: [{ tool: "browser.navigate", args: { url: "https://a.example" } }, { tool: "browser.wait_for", args: { textGone: "Loading" } }] },
      { run: async (_id, name) => (name === "browser.wait_for" ? { met: false } : { ok: true }), checkpoint: async () => {}, available: () => true },
    );

    const searchReplies: Record<string, unknown> = {
      "https://google.serper.dev/shopping": { shopping: [{ price: "$1", rating: 4, ratingCount: 12.7, imageUrl: "https://i.example/a.png", link: "https://s.example/a", source: "Shop", title: "Tea", citedBy: 3, year: 2020, date: "" }, { website: "https://w.example", title: " " }, { cid: "a b/ç", snippet: "s" }], knowledgeGraph: { description: `${"x".repeat(650)}  ` } },
      "https://data.decodo.com/v1/scrape": { results: [{ content: { results: { results: { organic: [{ rating: 4.5, image: "https://i.example/b.png", author: "Ann", duration: "1:00", date: 2026, domain: "d.example", description: "D", link: "https://d.example/a", title: "Doc" }], ai_overviews: [{ answer_text: "  Overview 😀 " }] } } } }] },
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(searchReplies[url]), { status: 200 })));
    const searched = async (provider: "serper" | "decodo", query: unknown) => {
      setDeviceModels({ version: 1, providers: {}, models: { agent: "fixture/model" }, search: { provider, apiKey: "k" } } as never);
      return deviceWebSearch(query);
    };

    write(join(fixtures, "runtime_tools/strings.json"), {
      webSearchDecodo: webSearchDescriptor("decodo"),
      webSearchSerper: webSearchDescriptor("serper"),
      webFetch: webFetchDescriptor,
      executionInstructions,
      toolsets: [
        toolsets(["web.search", "web.fetch"]),
        toolsets(["web.search", "web.fetch", "note.search", "screen.open", "screen.look", "browser.workspace.focus", "integration.search", "integration.execute", "agent.delegate", "browser.tab.list"]),
        toolsets(["web.search", "browser.snapshot", "browser.steps"]),
        toolsets(["web.search", "screen.open", "browser.run", "browser.snapshot", "browser.workspace.focus", "note.search", "agent.wait"], "Check my calendar and my notes"),
        toolsets(["integration.search"]),
      ],
      proofTabsList: proofTabsRefusal("keep it open", [], "browser_tab_list"),
      proofTabsProgram: proofTabsRefusal("keep it open", [], undefined, "browser_run"),
      companion: parts,
      initialMessages: input,
      monitor: {
        ownTab: await monitorWords("screen.open", { success: true, output: { status: "uncertain" } }, { url: "https://a.example" }),
        close: await monitorWords("screen.close", { success: false, error: "boom timeout" }),
        nobody: await monitorWords("browser.request_user_action", { success: false, error: "boom" }),
        rejected: await monitorWords("note.update", { success: false, error: "tool_execution_failed: conflict here" }, {}, true),
        uncertainWrite: await monitorWords("note.update", { success: true, output: { status: "uncertain" } }),
        pageLook: await monitorWords("browser.steps", { success: true, output: { status: "uncertain" } }),
      },
      replay: replayed,
      notes: { billing: billingNote("$10 monthly"), browser: browserNote(404, "") },
      visible: Object.fromEntries(["browser_webview_unavailable", "desktop_accessibility_required", "desktop_screen_recording_required", "invalid_tool_input", "permission_denied", "tool_unavailable", "conflict", "rate_limited", "timeout", "other"].map((text) => [text, visibleErrorMessage(new Error(text))])),
      classified: Object.fromEntries(["agent_model_turn_limit", "agent_execution_time_limit", "model_key_needed", "model_unsupported", "model_base_url_invalid", "timed out", "usage_limit_reached too many agent tasks", "usage_limit_reached starting agent tasks faster", "usage_limit_reached", "authorization_or_state_changed", "insufficient_quota", "invalid_api_key", "service temporarily unavailable", "nothing known"].map((text) => [text, classifyRuntimeError(new Error(text))])),
      unconfirmed: [undefined, { status: "uncertain" }, { status: "device_required" }, { denied: true }, { unavailable: true }, { status: "failure", tool_error: { message: "x".repeat(600) } }].map((output) => unconfirmedToolResultReason(output)),
      handoffs: ["screen_requested", "waiting_for_user", "awaiting_approval", "awaiting_answer", "plan_proposed"].map((status) => classifyToolOutcome({ success: true, readOnly: false, rejected: false, output: { status } })),
      unfinished: [unfinishedModelResult(true, 1, "stop"), unfinishedModelResult(false, 20, "tool-calls"), unfinishedModelResult(false, 3, "length"), unfinishedModelResult(false, 3, "other")],
      incomplete: incompleteToolResultText([{ toolName: "a.b_c", error: "  " }, { toolName: "d", error: `${"e".repeat(310)} ` }]),
      visual: visualToolOutput("browser.visual", { z: 1, displayCaptures: [{ name: "s", dataUrl: "data:image/png;base64,AA==", width: 1.5, height: 2 }], "10": true, a: { b: [1.5, null] } }),
      activity: deviceToolActivity({ url: "https://tea.example" }, { title: "Tea", url: "https://tea.example/final", text: "é" }),
      search: {
        serper: await searched("serper", { query: "tea", kind: "shopping", max_results: 3, near: " @1,2,3z ", location: " Here " }),
        decodo: await searched("decodo", { query: "tea", kind: "web", domains: ["a.example", " ", 3], recency: "month", max_results: 2.5, location: " " }),
        limited: await searched("decodo", { query: "tea limited", kind: "nope", max_results: 0 }),
        unavailable: (setDeviceModels({ version: 1, providers: {}, models: { agent: "fixture/model" } } as never), await deviceWebSearch({ query: "x" })),
      },
    });
  });
});
