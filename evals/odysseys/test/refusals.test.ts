import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.ts";
import { judgeFromEnv } from "../judge-config.ts";
import { isLocalUrl } from "../local.ts";

const good = {
  MISTY_BROWSER_EVAL_BRIDGE: "http://127.0.0.1:47123",
  MISTY_BROWSER_EVAL_BRIDGE_TOKEN: "a-token-of-twenty-four-characters",
  MISTY_ODYSSEYS_JUDGE_MODEL: "anthropic/some-model",
  MISTY_ODYSSEYS_JUDGE_KEY: "not-a-real-key",
};

describe("only a local stack", () => {
  it("knows what's local", () => {
    for (const url of ["http://127.0.0.1:8081", "http://localhost:8081", "http://[::1]:8081", "http://misty.localhost"]) expect(isLocalUrl(url), url).toBe(true);
    for (const url of ["https://api.mistysys.com", "https://dev-api.mistysys.com/v1", "http://127.0.0.1.example.com", "http://localhost.example.com", "http://192.168.1.2:8081", "ftp://localhost", "not a url"])
      expect(isLocalUrl(url), url).toBe(false);
  });

  it("refuses a bridge elsewhere", () => {
    expect(loadConfig(good).bridge.url).toBe(good.MISTY_BROWSER_EVAL_BRIDGE);
    expect(() => loadConfig({ ...good, MISTY_BROWSER_EVAL_BRIDGE: "https://bridge.example.com" })).toThrow("only against a local stack");
  });

  it("refuses from the command line, with a sentence and no stack trace", () => {
    const result = spawnSync(process.execPath, [resolve(import.meta.dirname, "../run.ts")], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, ...good, MISTY_BROWSER_EVAL_BRIDGE: "https://bridge.example.com" },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("only against a local stack");
    expect(result.stderr).not.toContain("    at ");
  });
});

describe("a pass that would mean nothing", () => {
  it("refuses a turn limit a server can't honor", () => {
    expect(loadConfig(good).turns).toBe(100);
    expect(loadConfig({ ...good, MISTY_ODYSSEYS_TURNS: "200" }).turns).toBe(200);
    for (const turns of ["20", "201", "many"]) expect(() => loadConfig({ ...good, MISTY_ODYSSEYS_TURNS: turns }), turns).toThrow("MISTY_ODYSSEYS_TURNS");
  });

  it("needs the bridge", () => {
    expect(() => loadConfig({ ...good, MISTY_BROWSER_EVAL_BRIDGE: "" })).toThrow("eval bridge");
  });

  it("names no model of its own", () => {
    expect(JSON.stringify(Object.keys(loadConfig(good)))).not.toContain("model");
  });
});

describe("the judge's settings", () => {
  const judge = { MISTY_ODYSSEYS_JUDGE_MODEL: "anthropic/m", MISTY_ODYSSEYS_JUDGE_KEY: "k" };
  it("routes by provider", () => {
    expect(judgeFromEnv(judge)).toMatchObject({ provider: "anthropic", providerModel: "m" });
    expect(judgeFromEnv({ ...judge, MISTY_ODYSSEYS_JUDGE_MODEL: "google/g" })).toMatchObject({ provider: "google", providerModel: "g" });
    expect(judgeFromEnv({ ...judge, MISTY_ODYSSEYS_JUDGE_MODEL: "openai/o" })).toMatchObject({ provider: "openai", providerModel: "o" });
    expect(judgeFromEnv({ ...judge, MISTY_ODYSSEYS_JUDGE_MODEL: "vendor/model", MISTY_ODYSSEYS_JUDGE_BASE_URL: "https://example.com/v1/" }))
      .toMatchObject({ provider: "openai-compatible", providerModel: "vendor/model", baseUrl: "https://example.com/v1" });
  });
  it("refuses what can't work or isn't safe", () => {
    expect(() => judgeFromEnv({ MISTY_ODYSSEYS_JUDGE_KEY: "k" })).toThrow("MISTY_ODYSSEYS_JUDGE_MODEL");
    expect(() => judgeFromEnv({ MISTY_ODYSSEYS_JUDGE_MODEL: "anthropic/m" })).toThrow("MISTY_ODYSSEYS_JUDGE_KEY");
    expect(() => judgeFromEnv({ ...judge, MISTY_ODYSSEYS_JUDGE_MODEL: "mystery/m" })).toThrow("names no provider");
    expect(() => judgeFromEnv({ ...judge, MISTY_ODYSSEYS_JUDGE_BASE_URL: "http://example.com/v1" })).toThrow("https");
    expect(() => judgeFromEnv({ ...judge, MISTY_ODYSSEYS_JUDGE_BASE_URL: "https://u:p@example.com/v1" })).toThrow("sign-in");
  });
});
