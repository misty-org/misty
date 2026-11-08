import { beforeEach, describe, expect, it, vi } from "vitest";
import core from "../../../../src-tauri/features/browser/agent_pages/page_agent/page_core.js?raw";
import tree from "../../../../src-tauri/features/browser/agent_pages/page_agent/page_tree.js?raw";
import actions from "../../../../src-tauri/features/browser/agent_pages/page_agent/page_actions.js?raw";
import consequence from "../../../../src-tauri/features/browser/agent_pages/page_agent/page_consequence.js?raw";
import read from "../../../../src-tauri/features/browser/agent_pages/page_agent/page_read.js?raw";
import skills from "../../../../src-tauri/features/browser/agent_pages/page_agent/page_skills.js?raw";

// The agent page runtime (src-tauri/features/browser/agent_pages/page_agent) runs inside each
// browser page. These tests load the same files into jsdom.
type Page = { call: (operation: string, args?: Record<string, unknown>) => any };
const globals = globalThis as unknown as { __mistyAgentPageV1?: Page };

function load(html: string): Page {
  document.body.innerHTML = html;
  delete globals.__mistyAgentPageV1;
  new Function(`${core}\n${tree}\n${actions}\n${consequence}\n${read}\n${skills}`)();
  return globals.__mistyAgentPageV1!;
}

function snapshot(page: Page, extra: Record<string, unknown> = {}) {
  const result = page.call("snapshot", { candidateId: "doc-1", maxChars: 20000, ...extra });
  expect(result.ok).toBe(true);
  return result as { documentId: string; tree: string; truncated: boolean; refCount: number };
}

function refFor(text: string, line: RegExp): string {
  const match = text
    .split("\n")
    .find((entry) => line.test(entry))
    ?.match(/\[ref=(e\d+)\]/);
  if (!match) throw new Error(`no ref for ${line} in\n${text}`);
  return match[1];
}

beforeEach(() => {
  // jsdom has no layout: give every element a box and make hit tests land on it.
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
});

describe("agent page runtime", () => {
  it("snapshots roles, names, states and values with refs", () => {
    const page = load(`
      <h1>Checkout</h1>
      <nav aria-label="Main"><a href="/home">Home</a></nav>
      <form>
        <label for="email">Email</label><input id="email" type="email" value="ada@example.com">
        <label><input type="checkbox" checked> Keep me posted</label>
        <select aria-label="Size"><option>Small</option><option selected>Large</option></select>
        <input type="password" aria-label="Password">
        <button type="submit">Place order</button>
      </form>
      <p style="display:none">secret text</p>
      <div aria-hidden="true"><button>Hidden</button></div>`);
    const { tree: text, documentId } = snapshot(page);
    expect(documentId).toBe("doc-1");
    expect(text).toContain('- heading "Checkout" [level=1]');
    expect(text).toMatch(/- navigation "Main":\n\s+- link "Home" \[ref=e\d+\] \[url=\/home\]/);
    expect(text).toMatch(/- textbox "Email" \[ref=e\d+\]: "ada@example.com"/);
    expect(text).toMatch(/- checkbox "Keep me posted" \[checked\] \[ref=e\d+\]/);
    expect(text).toMatch(/- combobox "Size" \[ref=e\d+\]: "Large"/);
    expect(text).toMatch(/- button "Place order" \[ref=e\d+\]/);
    // Passwords are listed without a ref, so the agent cannot type them.
    expect(text).toMatch(/- textbox "Password" \[password — only the person may enter it\]$/m);
    expect(text).not.toContain("secret text");
    expect(text).not.toContain("Hidden");
  });

  it("keeps refs stable across snapshots and actions", () => {
    const page = load(`<input aria-label="Name"><button>Save</button>`);
    const first = snapshot(page);
    const name = refFor(first.tree, /textbox "Name"/);
    const filled = page.call("perform", {
      documentId: first.documentId,
      step: { action: "fill", ref: name, text: "Ada" },
    });
    expect(filled).toMatchObject({ ok: true, retained: true });
    const second = snapshot(page);
    expect(refFor(second.tree, /textbox "Name"/)).toBe(name);
    expect(second.tree).toContain(`[ref=${name}]: "Ada"`);
    // The same document keeps its id, so earlier refs stay usable.
    expect(second.documentId).toBe(first.documentId);
  });

  it("reports a removed or changed control as stale before acting", () => {
    const page = load(`<button id="go">Continue</button>`);
    const { tree: text, documentId } = snapshot(page);
    const go = refFor(text, /button "Continue"/);
    document.getElementById("go")!.textContent = "Something else";
    expect(page.call("perform", { documentId, step: { action: "click", ref: go } })).toMatchObject({
      ok: false,
      errorCode: "browser_snapshot_stale",
      attempted: false,
    });
    expect(
      page.call("perform", { documentId: "other", step: { action: "click", ref: go } }),
    ).toMatchObject({
      errorCode: "browser_snapshot_stale",
    });
  });

  it("double-clicks and right-clicks as a browser does when acting by page events", () => {
    const page = load(`<div role="gridcell" id="cell" tabindex="0">B2</div>`);
    const { tree: text, documentId } = snapshot(page);
    const cell = refFor(text, /gridcell "B2"/);
    const seen: string[] = [];
    for (const type of ["click", "dblclick", "contextmenu"])
      document
        .getElementById("cell")!
        .addEventListener(type, (event) =>
          seen.push(`${type}:${(event as MouseEvent).detail}:${(event as MouseEvent).button}`),
        );
    page.call("perform", { documentId, step: { action: "click", ref: cell, clickCount: 2 } });
    // A spreadsheet opens its cell editor on dblclick, so a double-click must send one.
    expect(seen).toEqual(["click:1:0", "click:2:0", "dblclick:2:0"]);
    seen.length = 0;
    page.call("perform", { documentId, step: { action: "click", ref: cell, button: "right" } });
    expect(seen).toEqual(["contextmenu:1:2"]);
  });

  it("refuses to type into password, one-time code and card fields", () => {
    const page = load(
      `<input aria-label="Code" autocomplete="one-time-code"><input aria-label="Card" autocomplete="cc-number">`,
    );
    const { tree: text, documentId } = snapshot(page);
    expect(text).not.toMatch(/\[ref=/);
    expect(text).toContain("one-time code — only the person may enter it");
    expect(text).toContain("payment card — only the person may enter it");
    expect(documentId).toBe("doc-1");
  });

  describe("the stop before sending or paying", () => {
    const kindOf = (html: string, selector: string, action = "click", modifiers: string[] = []) => {
      const page = load(html);
      snapshot(page);
      const element = document.querySelector(selector) as HTMLElement;
      element.focus();
      document.elementFromPoint = vi.fn(() => element);
      const judged =
        action === "key"
          ? page.call("consequenceOfKey", { key: "Enter", modifiers })
          : page.call("consequenceAt", { x: 0.5, y: 0.5 });
      return judged.consequenceKind;
    };

    it("judges what's under a click, whatever the model said about it", () => {
      expect(kindOf("<button>Send</button>", "button")).toBe("send");
      expect(kindOf("<button><span>Delete account</span></button>", "button")).toBe("delete");
      expect(kindOf("<button>Next</button>", "button")).toBe("");
    });

    it("knows a Send button in other languages and scripts", () => {
      for (const name of [
        "Enviar",
        "Envoyer",
        "Senden",
        "Invia",
        "Отправить",
        "送信",
        "发送",
        "보내기",
      ])
        expect(kindOf(`<button>${name}</button>`, "button"), name).toBe("send");
      for (const name of [
        "Pagar",
        "Payer",
        "Bezahlen",
        "Jetzt kaufen",
        "Купить",
        "購入",
        "付款",
        "결제",
      ])
        expect(kindOf(`<button>${name}</button>`, "button"), name).toBe("payment");
      for (const name of ["Eliminar", "Supprimer", "Löschen", "Удалить", "削除", "삭제"])
        expect(kindOf(`<button>${name}</button>`, "button"), name).toBe("delete");
      expect(kindOf("<button>Publicar</button>", "button")).toBe("publish");
    });

    it("goes by a payment form's fields and address, whatever its button says", () => {
      const named =
        '<form><input autocomplete="billing cc-number"><button type="submit">Weiter</button></form>';
      expect(kindOf(named, "button")).toBe("payment");
      const cvc = '<form><input name="card_cvc"><input type="submit" value="Weiter"></form>';
      expect(kindOf(cvc, "input[type=submit]")).toBe("payment");
      const address =
        '<form action="/shop/checkout?x=1"><button type="submit">Weiter</button></form>';
      expect(kindOf(address, "button")).toBe("payment");
      const frame =
        '<form><iframe src="https://js.stripe.com/v3/x" title="f"></iframe><button>Weiter</button></form>';
      expect(kindOf(frame, "button")).toBe("payment");
      const plain =
        '<form action="/search?q=checkout"><button type="submit">Weiter</button></form>';
      expect(kindOf(plain, "button")).toBe("");
    });

    it("stops Enter in a composer outside a form, and not in a search box or an editor", () => {
      const composer =
        '<div><div contenteditable="true" aria-label="Message #general"></div></div>';
      expect(kindOf(composer, "[contenteditable]", "key")).toBe("send");
      const beside = "<div><textarea></textarea><button>Send</button></div>";
      expect(kindOf(beside, "textarea", "key")).toBe("send");
      const translated = '<div><textarea placeholder="メッセージを入力"></textarea></div>';
      expect(kindOf(translated, "textarea", "key")).toBe("send");
      expect(kindOf('<input type="search" aria-label="Search">', "input", "key")).toBe("");
      expect(
        kindOf('<input aria-label="Search messages"><button>Send</button>', "input", "key"),
      ).toBe("");
      expect(
        kindOf(
          '<div contenteditable="true" aria-label="Document body"></div>',
          "[contenteditable]",
          "key",
        ),
      ).toBe("");
    });

    it("takes Cmd or Ctrl+Enter in anything you can write in as sending", () => {
      const editor = '<div contenteditable="true" aria-label="Document body"></div>';
      expect(kindOf(editor, "[contenteditable]", "key", ["Meta"])).toBe("send");
      expect(kindOf("<textarea></textarea>", "textarea", "key", ["Control"])).toBe("send");
      expect(kindOf('<input type="search">', "input", "key", ["Meta"])).toBe("");
    });

    it("judges Enter on a focused button as pressing it", () => {
      expect(kindOf("<button>Send</button>", "button", "key")).toBe("send");
    });

    it("names controls for a question, and says which take a password", () => {
      const page = load(
        '<form><button>Send</button><label>Password <input type="password"></label></form>',
      );
      const { tree: text } = snapshot(page);
      const button = refFor(text, /button "Send"/);
      expect(page.call("describeRef", { ref: button })).toEqual({
        name: 'button "Send"',
        password: false,
      });
      const secret = (page as unknown as { register: (el: Element) => string }).register(
        document.querySelector("input")!,
      );
      expect(page.call("describeRef", { ref: secret }).password).toBe(true);
      expect(page.call("describeRef", { ref: "e9999" }).name).toBe("");
    });
  });

  it("flags clicks that send, buy or delete", () => {
    const page = load(`
      <button>Send</button><button>Search</button>
      <form><input aria-label="Card" autocomplete="cc-number"><button>Continue</button></form>
      <form><input aria-label="Message"><button>Post reply</button></form>`);
    const { tree: text, documentId } = snapshot(page);
    const prepare = (line: RegExp, action = "click", key?: string) => {
      const ref = refFor(text, line);
      document.elementFromPoint = vi.fn(
        () => document.querySelector(`button, input`) && findByRef(page, ref),
      );
      return page.call("prepare", { documentId, ref, action, key });
    };
    expect(prepare(/button "Send"/).consequence).toMatch(/Send/);
    expect(prepare(/button "Search"/).consequence).toBe("");
    expect(prepare(/button "Continue"/).consequence).toMatch(/payment/);
    expect(prepare(/textbox "Message"/, "key", "Enter").consequence).toMatch(/Post reply/);
    expect(prepare(/textbox "Message"/, "key", "Tab").consequence).toBe("");
  });

  it("lets a plain link named buy open its page, but still asks about a delete link", () => {
    const page = load(`
      <a href="https://store.test/stamps">Buy Christmas Forever Stamps Now</a>
      <a href="https://store.test/account/remove">Delete account</a>
      <button>Buy now</button>`);
    const { tree: text, documentId } = snapshot(page);
    const prepare = (line: RegExp) => {
      const ref = refFor(text, line);
      document.elementFromPoint = vi.fn(() => findByRef(page, ref));
      return page.call("prepare", { documentId, ref, action: "click" });
    };
    expect(prepare(/link "Buy Christmas/)).toMatchObject({ consequence: "", consequenceKind: "" });
    expect(prepare(/link "Delete account"/).consequenceKind).toBe("delete");
    expect(prepare(/button "Buy now"/).consequenceKind).toBe("payment");
  });

  it("finds a covered target and names what covers it", () => {
    const page = load(
      `<button>Buy now</button><div id="cookie" role="dialog" aria-label="Cookies">Accept</div>`,
    );
    const { tree: text, documentId } = snapshot(page);
    document.elementFromPoint = vi.fn(() => document.getElementById("cookie"));
    const result = page.call("prepare", {
      documentId,
      ref: refFor(text, /button "Buy now"/),
      action: "click",
    });
    expect(result).toMatchObject({
      ok: false,
      attempted: false,
      errorCode: "browser_target_covered",
    });
    expect(result.error).toContain('dialog "Cookies"');
  });

  it("returns a click point as a fraction of the viewport", () => {
    const page = load(`<button>Next</button>`);
    const { tree: text, documentId } = snapshot(page);
    const ref = refFor(text, /button "Next"/);
    document.elementFromPoint = vi.fn(() => document.querySelector("button"));
    const result = page.call("prepare", { documentId, ref, action: "click" });
    expect(result.ok).toBe(true);
    expect(result.point.x).toBeCloseTo(60 / innerWidth);
    expect(result.point.y).toBeCloseTo(25 / innerHeight);
  });

  it("fills, selects and checks", () => {
    const page = load(`
      <textarea aria-label="Notes"></textarea>
      <select aria-label="Color"><option value="r">Red</option><option value="b">Blue</option></select>
      <input type="checkbox" aria-label="Agree">`);
    const { tree: text, documentId } = snapshot(page);
    const step = (action: string, line: RegExp, extra = {}) =>
      page.call("perform", { documentId, step: { action, ref: refFor(text, line), ...extra } });
    expect(step("fill", /textbox "Notes"/, { text: "line one" })).toMatchObject({
      ok: true,
      retained: true,
    });
    expect(step("select", /combobox "Color"/, { values: ["Blue"] })).toMatchObject({
      ok: true,
      selected: ["Blue"],
    });
    expect((document.querySelector("select") as HTMLSelectElement).value).toBe("b");
    expect(step("fill", /combobox "Color"/, { text: "Red" })).toMatchObject({
      ok: true,
      selected: ["Red"],
    });
    expect(step("check", /checkbox "Agree"/)).toMatchObject({ ok: true, checked: true });
    expect(step("check", /checkbox "Agree"/)).toMatchObject({ ok: true, unchanged: true });
    expect(step("select", /combobox "Color"/, { values: ["Green"] })).toMatchObject({ ok: false });
  });

  it("selects an option in a type-ahead field by typing it", () => {
    const page = load(
      `<input aria-label="Country" list="c"><datalist id="c"><option>Canada</option></datalist>`,
    );
    const { tree: text, documentId } = snapshot(page);
    const ref = refFor(text, /combobox "Country"/);
    expect(
      page.call("perform", { documentId, step: { action: "select", ref, values: ["Canada"] } }),
    ).toMatchObject({ ok: true, selected: ["Canada"] });
    expect((document.querySelector("input") as HTMLInputElement).value).toBe("Canada");
  });

  it("lists file inputs hidden behind upload buttons", () => {
    const page = load(`<button>Upload</button><input type="file" hidden aria-label="Resume">`);
    const { tree: text } = snapshot(page);
    expect(text).toMatch(/- button "Resume" \[file input\] \[ref=e\d+\]/);
  });

  it("finds elements by description", () => {
    const page = load(
      `<input aria-label="Search mail"><button>Compose</button><a href="/inbox">Inbox</a>`,
    );
    const found = page.call("find", { candidateId: "doc-1", query: "compose button" });
    expect(found.matches[0]).toMatch(/button "Compose"/);
  });

  it("turns the page into Markdown for extraction", () => {
    const page =
      load(`<h2>Prices</h2><ul><li>Basic $0</li><li>Pro $12</li></ul><a href="https://example.com/x">Details</a>
      <table><tr><th>Plan</th><th>Price</th></tr><tr><td>Max</td><td>$20</td></tr></table>`);
    const result = page.call("markdown", { maxChars: 10000 });
    expect(result.markdown).toContain("## Prices");
    expect(result.markdown).toContain("- Basic $0");
    expect(result.markdown).toContain("[Details](https://example.com/x)");
    expect(result.markdown).toContain("| Max | $20 |");
  });

  it("hands over what collapsed sections hold, but not menus", () => {
    const page = load(`<h2>Benefits</h2>
      <details><summary>Pay</summary><p>Annual salary review for every graduate.</p></details>
      <button aria-expanded="false" aria-controls="perks">Perks</button>
      <div id="perks" hidden>Twenty-six days of holiday plus bank holidays.</div>
      <nav><button aria-expanded="false" aria-controls="menu">Menu</button>
      <ul id="menu" hidden><li>Careers home and every other section</li></ul></nav>`);
    const { collapsed } = page.call("markdown", { maxChars: 10000 });
    expect(collapsed).toContain("- Pay: Annual salary review for every graduate.");
    expect(collapsed).toContain("- Perks: Twenty-six days of holiday plus bank holidays.");
    expect(collapsed).not.toContain("Careers home");
  });

  it("truncates long pages with a marker instead of failing", () => {
    const page = load(
      Array.from({ length: 400 }, (_, i) => `<p>Paragraph ${i} with some words</p>`).join(""),
    );
    const result = snapshot(page, { maxChars: 2000 });
    expect(result.truncated).toBe(true);
    expect(result.tree.length).toBeLessThanOrEqual(2000);
  });

  it("keeps a long page's content and search box ahead of its menus", () => {
    const links = Array.from(
      { length: 300 },
      (_, i) => `<li><a href="/c/${i}">Category number ${i}</a></li>`,
    ).join("");
    const page = load(`
      <header><nav aria-label="Departments"><ul>${links}</ul></nav></header>
      <main><h1>Find a doctor</h1><form role="search"><input aria-label="Doctor name or specialty"><button>Search</button></form>
      <p>Results appear below.</p></main>
      <footer><nav aria-label="Footer"><ul>${links}</ul></nav></footer>`);
    const result = snapshot(page, { maxChars: 8000 });
    expect(result.tree.length).toBeLessThanOrEqual(8000);
    expect(result.tree).toContain("Find a doctor");
    expect(refFor(result.tree, /textbox "Doctor name or specialty"/)).toMatch(/^e\d+$/);
    expect(result.tree).toMatch(/more items in this navigation left out/);
    expect(result.tree).toContain("Category number 0");
  });

  it("names a popup covering the page and closes it with its own close control", async () => {
    const page = load(`
      <main><h1>Hotel results</h1><p>Twelve hotels near the park.</p></main>
      <div id="promo" style="position:fixed"><h2>Get 10% off your first stay</h2>
        <button>Subscribe</button><button aria-label="Close">×</button></div>`);
    const promo = document.getElementById("promo")!;
    const inside = promo.querySelector("h2")!;
    document.elementFromPoint = vi.fn(() => inside);
    vi.spyOn(promo, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1024,
      bottom: 768,
      width: 1024,
      height: 768,
      toJSON: () => ({}),
    } as DOMRect);
    const result = snapshot(page);
    expect(result.tree.split("\n")[0]).toMatch(
      /^- note: A popup covers this page \("Get 10% off your first stay"\)\. Close it first: click ref=e\d+\.$/,
    );
    const pressed: string[] = [];
    promo
      .querySelectorAll("button")
      .forEach((button) =>
        button.addEventListener("click", () => pressed.push(button.textContent ?? "")),
      );
    // Its close control is pressed first; a popup that stays is then hidden in the agent's tab.
    const dismissed = await page.call("dismissPopup");
    expect(dismissed.dismissed).toContain("Get 10% off");
    expect(pressed).toEqual(["×"]);
    expect(promo.style.display).toBe("none");
  });

  it("scrolls what it finds into view", () => {
    const page = load(`<p>Intro</p><p>Check-in is at 4 pm and parking costs $35 a night.</p>`);
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const result = page.call("find", { candidateId: "doc-1", query: "parking costs" });
    expect(result.scrolledTo).toContain("parking costs $35");
    expect(scrolled).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
  });

  it("checks wait conditions without acting", () => {
    const page = load(`<p>Saving…</p>`);
    expect(page.call("waitCheck", { text: "saved" }).met).toBe(false);
    document.body.innerHTML = "<p>Saved</p>";
    expect(page.call("waitCheck", { text: "saved", textGone: "saving" }).met).toBe(true);
  });
});

function findByRef(page: Page, ref: string): Element | null {
  const state = (page as unknown as { state: { refs: Map<string, { el: Element }> } }).state;
  return state.refs.get(ref)?.el ?? null;
}
