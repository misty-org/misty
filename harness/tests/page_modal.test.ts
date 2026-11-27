import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import roles from "../crates/page-runtime/js/vendor_playwright_roles.js?raw";
import core from "../crates/page-runtime/js/page_core.js?raw";
import tree from "../crates/page-runtime/js/page_tree.js?raw";
import actions from "../crates/page-runtime/js/page_actions.js?raw";
import consequence from "../crates/page-runtime/js/page_consequence.js?raw";
import read from "../crates/page-runtime/js/page_read.js?raw";
import skills from "../crates/page-runtime/js/page_skills.js?raw";
import effects from "../crates/page-runtime/js/page_effects.js?raw";
import modal from "../crates/page-runtime/js/page_modal.js?raw";
import dialogs from "../crates/page-runtime/js/page_dialogs.js?raw";

type Page = { call: (operation: string, args?: Record<string, unknown>) => any };
const globals = globalThis as unknown as { __mistyAgentPageV1?: Page };

const native = { alert: [] as unknown[], confirm: [] as unknown[], prompt: [] as unknown[] };

beforeAll(() => {
  window.alert = (message?: unknown) => {
    native.alert.push(message);
  };
  window.confirm = (message?: unknown) => {
    native.confirm.push(message);
    return true;
  };
  window.prompt = (message?: unknown) => {
    native.prompt.push(message);
    return "native";
  };
  new Function(dialogs)();
});

function load(html: string): Page {
  document.body.innerHTML = html;
  delete globals.__mistyAgentPageV1;
  new Function(`${roles}
${core}\n${tree}\n${actions}\n${consequence}\n${read}\n${skills}\n${effects}\n${modal}`)();
  return globals.__mistyAgentPageV1!;
}

beforeEach(() => {
  native.alert.length = 0;
  native.confirm.length = 0;
  native.prompt.length = 0;
  document.documentElement.removeAttribute("data-misty-acting");
});

describe("dialogs while the agent acts", () => {
  it("leaves the page's dialogs alone when no steps run", () => {
    const page = load("<p>Hi</p>");
    expect(window.confirm("Leave?")).toBe(true);
    expect(native.confirm).toEqual(["Leave?"]);
    expect(page.call("dialogSeen").dialog).toBeNull();
  });

  it("dismisses an unarmed confirm and reports it", () => {
    const page = load("<p>Hi</p>");
    page.call("acting", { on: true });
    expect(window.confirm("Delete the file?")).toBe(false);
    expect(native.confirm).toEqual([]);
    expect(page.call("dialogSeen").dialog).toEqual({
      kind: "confirm",
      message: "Delete the file?",
      accepted: false,
    });
    expect(page.call("dialogSeen").dialog).toBeNull();
  });

  it("answers a prompt as armed, once", () => {
    const page = load("<p>Hi</p>");
    page.call("acting", { on: true });
    expect(page.call("armDialog", { accept: true, text: "Ada" }).armed).toBe(true);
    expect(window.prompt("Your name?", "x")).toBe("Ada");
    expect(page.call("dialogSeen").dialog).toEqual({
      kind: "prompt",
      message: "Your name?",
      accepted: true,
      text: "Ada",
    });
    expect(window.prompt("Again?")).toBeNull();
  });

  it("accepts an armed confirm and lets alerts through", () => {
    const page = load("<p>Hi</p>");
    page.call("acting", { on: true });
    page.call("armDialog", { accept: true });
    expect(window.confirm("Sure?")).toBe(true);
    expect(window.alert("Saved")).toBeUndefined();
    expect(page.call("dialogSeen").dialog).toMatchObject({ kind: "alert", accepted: true });
    expect(native.alert).toEqual([]);
  });

  it("hands an unarmed dialog to the host when it holds dialogs", () => {
    const page = load("<p>Hi</p>");
    page.call("acting", { on: true, hold: true });
    expect(window.confirm("Hold me?")).toBe(true);
    expect(native.confirm).toEqual(["Hold me?"]);
    page.call("armDialog", { accept: false });
    expect(window.confirm("Armed?")).toBe(false);
    expect(native.confirm).toEqual(["Hold me?"]);
    page.call("acting", { on: false });
    expect(document.documentElement.hasAttribute("data-misty-dialog-hold")).toBe(false);
  });

  it("stops answering once the steps end", () => {
    const page = load("<p>Hi</p>");
    page.call("acting", { on: true });
    page.call("acting", { on: false });
    expect(window.confirm("After?")).toBe(true);
    expect(native.confirm).toEqual(["After?"]);
  });
});

describe("file choosers while the agent acts", () => {
  it("holds back a click on a file input and names its ref", () => {
    const page = load('<input type="file" id="file"><button id="other">Other</button>');
    const input = document.getElementById("file") as HTMLInputElement;
    let opened = true;
    input.addEventListener("click", (event) => {
      opened = !event.defaultPrevented;
    });
    page.call("acting", { on: true });
    input.click();
    const seen = page.call("dialogSeen");
    expect(seen.fileChooser).toMatch(/^e\d+$/);
    expect(page.call("dialogSeen").fileChooser).toBeUndefined();
    input.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(opened).toBe(false);
    expect(page.call("dialogSeen").fileChooser).toBe(seen.fileChooser);
  });

  it("lets the person's own file clicks through", () => {
    const page = load('<input type="file" id="file">');
    const input = document.getElementById("file") as HTMLInputElement;
    let prevented = false;
    input.addEventListener("click", (event) => {
      prevented = event.defaultPrevented;
    });
    input.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(prevented).toBe(false);
    expect(page.call("dialogSeen").fileChooser).toBeUndefined();
  });
});
