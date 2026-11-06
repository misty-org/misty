// The debug build's eval bridge, for the smoke test: JavaScript in a person's own window.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Every script brings the helpers along, because a reload takes them away.
const helpers = readFileSync(resolve(here, "window-helpers.js"), "utf8").replace(
  "__REPO__",
  JSON.stringify(resolve(here, "../..")),
);
export async function bridge(path, body = {}, timeoutMs = 700_000) {
  const address = process.env.MISTY_BROWSER_EVAL_BRIDGE ?? "http://127.0.0.1:47123";
  const response = await fetch(`${address}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.MISTY_BROWSER_EVAL_BRIDGE_TOKEN ?? ""}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  const answer = await response.json();
  if (!answer.ok) throw new Error(`${path}: ${answer.error}`);
  return answer.result;
}

/** Runs the body of an async function in the window and returns what it returned. */
export function inWindow(script, { window, timeoutMs = 60_000 } = {}) {
  return bridge("/window-eval", { script: `${helpers}\n${script}`, window, timeoutMs }, timeoutMs + 10_000);
}

/** Resolves once the bridge answers and the window (the first one if unnamed) runs a script. */
export async function waitForWindow(timeoutMs = 240_000, window = undefined) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      if ((await inWindow("return document.readyState", { window, timeoutMs: 5_000 })) === "complete") return;
    } catch (error) {
      last = error;
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`The app's window never answered: ${last}`);
}
