import { beforeEach, describe, expect, it, vi } from "vitest";
import core from "../crates/page-runtime/js/page_core.js?raw";
import tree from "../crates/page-runtime/js/page_tree.js?raw";
import actions from "../crates/page-runtime/js/page_actions.js?raw";
import consequence from "../crates/page-runtime/js/page_consequence.js?raw";
import read from "../crates/page-runtime/js/page_read.js?raw";
import skills from "../crates/page-runtime/js/page_skills.js?raw";
import effects from "../crates/page-runtime/js/page_effects.js?raw";
import network from "../crates/page-runtime/js/page_network.js?raw";

// Step verdicts, the compact state, the sign-in probe and settle (page_effects.js, page_read.js),
// loaded into jsdom the way a host loads the runtime.
type Page = { call: (operation: string, args?: Record<string, unknown>) => any };
const globals = globalThis as unknown as { __mistyAgentPageV1?: Page };

function load(html: string): Page {
  document.body.innerHTML = html;
  delete globals.__mistyAgentPageV1;
  new Function(`${core}\n${tree}\n${actions}\n${consequence}\n${read}\n${skills}\n${effects}`)();
  return globals.__mistyAgentPageV1!;
}

/** Lets mutation observers deliver their records. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function refFor(text: string, line: RegExp): string {
  const match = text
    .split("\n")
    .find((entry) => line.test(entry))
    ?.match(/\[ref=(e\d+)\]/);
  if (!match) throw new Error(`no ref for ${line} in\n${text}`);
  return match[1];
}

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 10,
    y: 10,
    left: 10,
    top: 10,
    right: 110,
    bottom: 40,
    width: 100,
    height: 30,
    toJSON: () => ({}),
  } as DOMRect);
  document.elementFromPoint = vi.fn(() => null);
  document.execCommand = vi.fn(() => false);
  history.replaceState(null, "", "/");
  document.documentElement.removeAttribute("data-misty-busy");
});

describe("step effects", () => {
  it("says no change when the page did not react", async () => {
    const page = load("<button>Save</button>");
    const { token } = page.call("effectStart", {});
    await flush();
    expect(page.call("effectEnd", { token })).toMatchObject({ ok: true, effect: "no change" });
  });

  it("says the page changed when content appears", async () => {
    const page = load("<button>Save</button><div id=out></div>");
    const { token } = page.call("effectStart", {});
    document.getElementById("out")!.textContent = "Saved";
    await flush();
    const end = page.call("effectEnd", { token });
    expect(end.effect).toBe("page changed");
    expect(end.mutations).toBeGreaterThan(0);
  });

  it("ignores rewrites of an attribute's current value and Misty's own overlays", async () => {
    const page = load('<div id=box class="a"></div>');
    const { token } = page.call("effectStart", {});
    document.getElementById("box")!.setAttribute("class", "a");
    document.body.append(document.createElement("misty-agent-cursor"));
    const ring = document.createElement("div");
    ring.id = "misty-agent-ring";
    document.body.append(ring);
    await flush();
    expect(page.call("effectEnd", { token }).effect).toBe("no change");
  });

  it("counts a burst of style changes on one element once", async () => {
    const page = load("<div id=spin></div>");
    const { token } = page.call("effectStart", {});
    const spin = document.getElementById("spin")!;
    for (let frame = 1; frame <= 5; frame++) {
      spin.style.transform = `rotate(${frame * 10}deg)`;
      await flush();
    }
    expect(page.call("effectEnd", { token }).mutations).toBe(1);
  });

  it("reports the target's new value and checked state", async () => {
    const page = load('<input aria-label="City"><label><input type="checkbox"> Gift</label>');
    const text = page.call("snapshot", { candidateId: "doc-1" }).tree;
    const city = refFor(text, /textbox "City"/);
    let { token } = page.call("effectStart", { ref: city });
    (document.querySelector("input[aria-label=City]") as HTMLInputElement).value = "Oslo";
    await flush();
    expect(page.call("effectEnd", { token })).toMatchObject({ effect: "page changed", valueNow: "Oslo" });

    const gift = refFor(text, /checkbox "Gift"/);
    ({ token } = page.call("effectStart", { ref: gift }));
    (document.querySelector("input[type=checkbox]") as HTMLInputElement).checked = true;
    await flush();
    expect(page.call("effectEnd", { token })).toMatchObject({ effect: "page changed", checkedNow: true });
  });

  it("says navigated when the address changed or the step ended in another document", async () => {
    const page = load("<a href='/next'>Next</a>");
    let { token } = page.call("effectStart", {});
    history.pushState(null, "", "/next");
    expect(page.call("effectEnd", { token })).toMatchObject({ effect: "navigated" });
    ({ token } = page.call("effectStart", {}));
    expect(page.call("effectEnd", { token: "another-document" })).toMatchObject({ effect: "navigated", newDocument: true });
  });
});

describe("compact state", () => {
  it("marks only the controls that are new since the last read", async () => {
    const page = load("<button>Old</button>");
    const first = page.call("compact", { candidateId: "doc-1" });
    expect(first.tree).not.toMatch(/^\s*\*- /m);
    expect(first.newRefs).toBe(0);
    const added = document.createElement("button");
    added.textContent = "New";
    document.body.append(added);
    const second = page.call("compact", { candidateId: "doc-1" });
    expect(second.tree).toMatch(/^\*- button "New" \[ref=e\d+\]$/m);
    expect(second.tree).toMatch(/^- button "Old" \[ref=e\d+\]$/m);
    expect(second.tree).toContain("Lines starting with * are controls that are new");
    expect(second.newRefs).toBe(1);
    expect(second.documentId).toBe(first.documentId);
  });

  it("marks controls new since a full snapshot", () => {
    const page = load("<button>Old</button>");
    page.call("snapshot", { candidateId: "doc-1" });
    const added = document.createElement("button");
    added.textContent = "Added";
    document.body.append(added);
    expect(page.call("compact", { candidateId: "doc-1" }).tree).toMatch(/^\*- button "Added"/m);
  });

  it("keeps the start and the end of a long page and says what it left out", () => {
    const rows = Array.from({ length: 300 }, (_, index) => `<button>Item ${index}</button>`).join("");
    const page = load(rows);
    const state = page.call("compact", { candidateId: "doc-1", maxChars: 1000 });
    expect(state.truncated).toBe(true);
    expect(state.tree).toContain('button "Item 0"');
    expect(state.tree).toContain('button "Item 299"');
    expect(state.tree).toMatch(/\(\d+ lines in the middle left out; browser_snapshot reads the whole page/);
    expect(state.tree.length).toBeLessThan(1400);
  });
});

describe("sign-in probe", () => {
  it("names a password field", () => {
    const page = load('<form><input type="email" name="email"><input type="password"><button>Sign in</button></form>');
    expect(page.call("signIn").signIn).toMatchObject({ kind: "password" });
  });

  it("names the email-first step on a sign-in address", () => {
    history.replaceState(null, "", "/signin");
    const page = load('<form><input type="email" autocomplete="username"><button>Next</button></form>');
    expect(page.call("signIn").signIn).toMatchObject({ kind: "email or username first" });
  });

  it("leaves a newsletter field on an ordinary page alone", () => {
    const page = load('<main><p>News</p></main><footer><input type="email" name="email"><button>Subscribe</button></footer>');
    expect(page.call("signIn").signIn).toBeNull();
  });

  it("puts the note at the top of a snapshot", () => {
    const page = load('<form><input type="password" aria-label="Password"></form>');
    const text = page.call("snapshot", { candidateId: "doc-1" }).tree;
    expect(text.split("\n")[0]).toMatch(/^- note: This page asks someone to sign in \(password, /);
  });
});

describe("settle", () => {
  it("answers at once inside a step when the page has been quiet since it started", async () => {
    const page = load("<button>Save</button>");
    page.call("effectStart", {});
    await pause(120);
    const settled = await page.call("settle", { quietMs: 80, maxMs: 800 });
    expect(settled.waitedMs).toBeLessThan(60);
  });

  it("waits a full quiet period as a plain wait", async () => {
    const page = load("<button>Save</button>");
    const settled = await page.call("settle", { quietMs: 80, maxMs: 800 });
    expect(settled.waitedMs).toBeGreaterThanOrEqual(70);
  });

  it("waits while the network counter says requests are in flight", async () => {
    const page = load("<button>Save</button>");
    document.documentElement.setAttribute("data-misty-busy", "");
    setTimeout(() => document.documentElement.removeAttribute("data-misty-busy"), 200);
    const settled = await page.call("settle", { quietMs: 50, maxMs: 100, loadingMaxMs: 1000 });
    expect(settled.waitedMs).toBeGreaterThanOrEqual(190);
    expect(settled.busy).toBe(false);
  });

  it("gives up waiting for the network at loadingMaxMs", async () => {
    const page = load("<button>Save</button>");
    document.documentElement.setAttribute("data-misty-busy", "");
    const settled = await page.call("settle", { quietMs: 50, maxMs: 100, loadingMaxMs: 300 });
    expect(settled.waitedMs).toBeGreaterThanOrEqual(280);
    expect(settled.waitedMs).toBeLessThan(600);
    expect(settled.busy).toBe(true);
  });
});

describe("page-world network counter", () => {
  it("marks the page busy while a fetch is open", async () => {
    let finish: (value: Response) => void = () => {};
    window.fetch = vi.fn(() => new Promise<Response>((resolve) => (finish = resolve)));
    delete (window as unknown as Record<symbol, unknown>)[Symbol.for("misty.network")];
    new Function(network)();
    const pending = window.fetch("/data");
    expect(document.documentElement.hasAttribute("data-misty-busy")).toBe(true);
    finish(new Response("ok"));
    await pending;
    await flush();
    expect(document.documentElement.hasAttribute("data-misty-busy")).toBe(false);
  });
});
