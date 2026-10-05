import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A headless Chromium standing in for Misty's desktop browser in live
 * acceptance runs. It answers the same `browser_agent_execute` operations the
 * Tauri side does (fresh capture, one native action per capture) and draws the
 * same in-page agent cursor, so the shipped screen loop runs unchanged.
 */
export interface ChromiumDevice {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  open: (url: string) => Promise<void>;
  setContent: (html: string) => Promise<void>;
  evaluate: <T>(expression: string) => Promise<T>;
  close: () => Promise<void>;
}

const viewport = { width: 1280, height: 800 };
const cursorScript = readFileSync(
  new URL("../../../src-tauri/src/infra/browser_agent_cursor.js", import.meta.url),
  "utf8",
);

export function chromiumBinary(): string | undefined {
  if (process.env.MISTY_ACCEPTANCE_CHROMIUM) return process.env.MISTY_ACCEPTANCE_CHROMIUM;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(cache)) return undefined;
  const builds = readdirSync(cache)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
  for (const build of builds) {
    const app = join(cache, build, "chrome-mac-arm64/Google Chrome for Testing.app");
    const binary = join(app, "Contents/MacOS/Google Chrome for Testing");
    if (existsSync(binary)) return binary;
  }
  return undefined;
}

class Cdp {
  private next = 0;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private waiters: Array<{ method: string; resolve: () => void }> = [];

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        method?: string;
        result?: unknown;
        error?: { message: string };
      };
      if (message.id !== undefined) {
        const call = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) call?.reject(new Error(message.error.message));
        else call?.resolve(message.result);
      } else if (message.method) {
        this.waiters = this.waiters.filter((waiter) => {
          if (waiter.method !== message.method) return true;
          waiter.resolve();
          return false;
        });
      }
    });
  }

  static async connect(url: string) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new Cdp(socket);
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}) {
    const id = ++this.next;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise<T>((resolve, reject) =>
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject }),
    );
  }

  once(method: string, timeoutMs = 30_000) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.waiters.push({
        method,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      });
    });
  }

  close() {
    this.socket.close();
  }
}

const namedKeys: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Escape: { code: "Escape", keyCode: 27 },
  Tab: { code: "Tab", keyCode: 9 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Delete: { code: "Delete", keyCode: 46 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
  PageUp: { code: "PageUp", keyCode: 33 },
  PageDown: { code: "PageDown", keyCode: 34 },
  Space: { code: "Space", keyCode: 32, text: " " },
};
const modifierBits: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function launchChromiumDevice(): Promise<ChromiumDevice> {
  const binary = chromiumBinary();
  if (!binary) throw new Error("No Chromium found; set MISTY_ACCEPTANCE_CHROMIUM.");
  const profile = mkdtempSync(join(tmpdir(), "misty-acceptance-"));
  const child: ChildProcess = spawn(
    binary,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      `--window-size=${viewport.width},${viewport.height}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const browserUrl = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Chromium did not start.")), 20_000);
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once("exit", () => reject(new Error("Chromium exited during startup.")));
  });
  const port = new URL(browserUrl).port;
  const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
    type: string;
    webSocketDebuggerUrl: string;
  }>;
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error("Chromium has no page target.");
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    ...viewport,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: cursorScript });

  let documentId: string | undefined;
  const evaluate = async <T>(expression: string) => {
    const result = await cdp.send<{ result: { value?: T }; exceptionDetails?: unknown }>(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
    );
    if (result.exceptionDetails) throw new Error(`evaluate failed: ${expression.slice(0, 80)}`);
    return result.result.value as T;
  };
  const mouse = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
    cdp.send("Input.dispatchMouseEvent", { type, x, y, ...extra });

  async function capture() {
    const shot = await cdp.send<{ data: string }>("Page.captureScreenshot", {
      format: "jpeg",
      quality: 80,
    });
    documentId = randomUUID();
    return {
      documentId,
      image: { dataUrl: `data:image/jpeg;base64,${shot.data}`, ...viewport },
    };
  }

  // The same drawing the desktop's native input glides before each action.
  const moveCursor = (x: number, y: number) =>
    evaluate(
      `window[Symbol.for('misty.browser.agent.cursor')]?.move(${x.toFixed(1)},${y.toFixed(1)},{hold:true})`,
    );

  async function act(input: Record<string, unknown>) {
    const px = (value: unknown, size: number) => Number(value) * size;
    const kind = String(input.kind);
    const anchor =
      kind === "drag"
        ? [input.fromX, input.fromY]
        : kind === "click" || kind === "scroll"
          ? [input.x, input.y]
          : undefined;
    if (anchor) {
      await moveCursor(px(anchor[0], viewport.width), px(anchor[1], viewport.height));
      await sleep(180);
    }
    if (kind === "click") {
      const [x, y] = [px(input.x, viewport.width), px(input.y, viewport.height)];
      const button = input.button === "right" ? "right" : "left";
      const clickCount = input.clickCount === 2 ? 2 : 1;
      await mouse("mouseMoved", x, y);
      for (let count = 1; count <= clickCount; count++) {
        await mouse("mousePressed", x, y, { button, clickCount: count, buttons: 1 });
        await mouse("mouseReleased", x, y, { button, clickCount: count });
      }
    } else if (kind === "drag") {
      const from = [px(input.fromX, viewport.width), px(input.fromY, viewport.height)];
      const to = [px(input.toX, viewport.width), px(input.toY, viewport.height)];
      await mouse("mouseMoved", from[0], from[1]);
      await mouse("mousePressed", from[0], from[1], { button: "left", clickCount: 1, buttons: 1 });
      for (let step = 1; step <= 12; step++) {
        const t = step / 12;
        const [x, y] = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
        await mouse("mouseMoved", x, y, { button: "left", buttons: 1 });
        await moveCursor(x, y);
      }
      await mouse("mouseReleased", to[0], to[1], { button: "left", clickCount: 1 });
    } else if (kind === "type") {
      await cdp.send("Input.insertText", { text: String(input.text ?? "") });
    } else if (kind === "key") {
      const key = String(input.key);
      const modifiers = ((input.modifiers as string[] | undefined) ?? []).reduce(
        (bits, name) => bits | (modifierBits[name] ?? 0),
        0,
      );
      const named = namedKeys[key];
      const commands =
        modifiers & modifierBits.Meta
          ? (
              {
                a: ["selectAll"],
                z: modifiers & modifierBits.Shift ? ["redo"] : ["undo"],
              } as Record<string, string[]>
            )[key.toLowerCase()]
          : undefined;
      const base = {
        key: named ? key : key,
        code: named?.code ?? (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : undefined),
        windowsVirtualKeyCode: named?.keyCode ?? key.toUpperCase().charCodeAt(0),
        modifiers,
      };
      const text =
        modifiers & ~modifierBits.Shift ? undefined : (named?.text ?? (named ? undefined : key));
      await cdp.send("Input.dispatchKeyEvent", {
        type: text ? "keyDown" : "rawKeyDown",
        ...base,
        ...(text ? { text } : {}),
        ...(commands ? { commands } : {}),
      });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    } else if (kind === "scroll") {
      await mouse("mouseWheel", px(input.x, viewport.width), px(input.y, viewport.height), {
        deltaX: Number(input.deltaX ?? 0),
        deltaY: Number(input.deltaY ?? 0),
      });
    } else {
      throw new Error(`unsupported native action ${kind}`);
    }
    await sleep(450);
    const target =
      kind === "drag"
        ? [input.toX, input.toY]
        : kind === "click" || kind === "scroll"
          ? anchor
          : undefined;
    if (target) {
      await moveCursor(px(target[0], viewport.width), px(target[1], viewport.height));
      return { dispatched: true, cursor: { x: Number(target[0]), y: Number(target[1]) } };
    }
    return { dispatched: true };
  }

  const device: ChromiumDevice = {
    async invoke(command, args = {}) {
      const request = (args.request ?? {}) as {
        operation?: string;
        input?: Record<string, unknown>;
      };
      switch (command) {
        case "browser_runtime_for_scope":
          return "acceptance-runtime";
        case "browser_agent_grant_register":
        case "browser_agent_grant_revoke":
          return null;
        case "browser_agent_execute":
          if (request.operation === "browser.visual") return capture();
          if (request.operation === "browser.interact") {
            const input = request.input ?? {};
            // Like the desktop, each capture admits exactly one action.
            if (!documentId || input.documentId !== documentId)
              throw new Error("browser_snapshot_stale");
            documentId = undefined;
            const action = input.action as { kind: string; input: Record<string, unknown> };
            return act(action.input);
          }
          throw new Error(`unsupported operation ${request.operation}`);
        default:
          throw new Error(`unsupported command ${command}`);
      }
    },
    async open(url) {
      const loaded = cdp.once("Page.loadEventFired");
      await cdp.send("Page.navigate", { url });
      await loaded;
      await sleep(1500);
    },
    async setContent(html) {
      await device.open(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
    },
    evaluate,
    async close() {
      cdp.close();
      child.kill();
      await sleep(200);
      rmSync(profile, { recursive: true, force: true });
    },
  };
  return device;
}
