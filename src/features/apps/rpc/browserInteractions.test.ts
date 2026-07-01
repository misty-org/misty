import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const script = (name: string) =>
  Function(`return (${readFileSync(`${process.cwd()}/src-tauri/src/infra/${name}.js`, "utf8")})`)();
const inspect = script("browser_inspection_snapshot");
const interact = script("browser_inspection_interact");
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  delete (window as any).__MISTY_AGENT_INPUT_LOCKED__;
  delete (window as any)[Symbol.for("misty.browser.inspection")];
  delete (window as any)[Symbol.for("misty.browser.inspection.document")];
});

describe("native browser interaction fixtures", () => {
  it("names image controls and controls labelled by another element", () => {
    document.body.innerHTML = `<div role="button">  <img alt="Generated image: NORTHLINE shirt">  </div>
      <span id="download-label">Download image</span><button aria-labelledby="download-label"></button>`;
    expect(inspect("fixture", 4000, 50).interactive.map((control: any) => control.name)).toEqual([
      "Generated image: NORTHLINE shirt", "Download image",
    ]);
  });
  it("omits hidden backing editors while retaining the visible editor and upload inputs", () => {
    document.body.innerHTML = `<textarea style="display:none" aria-label="Chat"></textarea>
      <div aria-hidden="true"><button>Hidden menu action</button></div>
      <div contenteditable="true" role="textbox" aria-label="Chat"></div>
      <input type="file" style="display:none" aria-label="Upload">`;
    const snapshot = inspect("fixture", 4000, 50);
    expect(snapshot.interactive.map((control: any) => [control.tag, control.name])).toEqual([
      ["div", "Chat"], ["input", "Upload"],
    ]);
  });
  it("exposes every visible roving-tabindex menu action and activates the selected item once", () => {
    document.body.innerHTML = `<div role="menu">
      <div role="menuitem" tabindex="0">New folder</div>
      <div role="menuitem" tabindex="-1">File upload</div>
      <div role="menuitemcheckbox" tabindex="-1">Show hidden files</div>
      <div role="menuitemradio" tabindex="-1">List view</div>
      <div role="menuitem" tabindex="-1" hidden>Hidden action</div>
    </div>`;
    const snapshot = inspect("menu", 4000, 50);
    expect(snapshot.interactive.map((control: any) => control.name)).toEqual([
      "New folder", "File upload", "Show hidden files", "List view",
    ]);
    const upload = vi.fn();
    document.querySelectorAll('[role="menuitem"]')[1].addEventListener("click", upload);
    expect(script("browser_inspection_click")(snapshot.interactive[1].target).ok).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
  });
  it.each(["click", "key"])("rejects a %s after its inspected menu closes without removing its items", (kind) => {
    document.body.innerHTML = '<div role="menu"><div role="menuitem" tabindex="-1">File upload</div></div>';
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    const item = document.querySelector('[role="menuitem"]')!;
    const activated = vi.fn();
    item.addEventListener("click", activated);
    item.addEventListener("keydown", activated);
    const target = inspect("menu", 4000, 50).interactive[0].target;
    menu.style.display = "none";
    const result = kind === "click"
      ? script("browser_inspection_click")(target)
      : interact(target, { kind: "key", key: "Enter" }, location.origin);
    expect(result.errorCode).toBe("browser_snapshot_stale");
    expect(activated).not.toHaveBeenCalled();
  });
  it.each(["interact", "type"])("%s restores the human-input lock when a rich editor rejects insertion", (kind) => {
    document.body.innerHTML = '<div contenteditable="true" role="textbox" aria-label="Draft">Existing draft</div>';
    const editor = document.querySelector("div")!;
    Object.defineProperty(editor, "isContentEditable", { value: true });
    const target = inspect("fixture", 4000, 50).interactive[0].target;
    (window as any).__MISTY_AGENT_INPUT_LOCKED__ = true;
    const insert = vi.fn(() => {
      expect((window as any).__MISTY_AGENT_INPUT_LOCKED__).toBe(false);
      throw new Error("Editor rejected insertion");
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: insert });
    try {
      const result = kind === "interact"
        ? interact(target, { kind: "fill", text: "Replacement" }, location.origin)
        : script("browser_inspection_type")(target, "Replacement");
      expect(result.ok).toBe(false);
      expect(insert).toHaveBeenCalledWith("insertText", false, "Replacement");
      expect(editor.textContent).toBe("Existing draft");
      expect((window as any).__MISTY_AGENT_INPUT_LOCKED__).toBe(true);
    } finally {
      delete (document as any).execCommand;
    }
  });
  it("fills an inspected input once and emits an observable input event", () => {
    document.body.innerHTML = '<input aria-label="Draft subject">';
    const input = document.querySelector("input")!;
    const changed = vi.fn();
    input.addEventListener("input", changed);
    const snapshot = inspect("fixture", 4000, 50);
    const target = snapshot.interactive[0].target;
    expect(interact(target, { kind: "fill", text: "A real draft" }, location.origin)).toEqual({
      ok: true,
      attempted: true,
    });
    expect(input.value).toBe("A real draft");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(interact(target, { kind: "fill", text: "Duplicate" }, location.origin).ok).toBe(false);
    expect(input.value).toBe("A real draft");
  });
  it("rejects changed controls and a changed origin", () => {
    document.body.innerHTML = "<button>Draft</button>";
    const target = inspect("fixture", 4000, 50).interactive[0].target;
    document.querySelector("button")!.textContent = "Send to everyone";
    expect(interact(target, { kind: "key", key: "Enter" }, location.origin).ok).toBe(false);
    expect(interact(target, { kind: "key", key: "Enter" }, "https://wrong.example").ok).toBe(false);
  });
  it("requires a fresh document for each scroll, including pages without controls", () => {
    const scroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    expect(interact(null, { kind: "scroll", x: 0, y: 100 }, location.origin).ok).toBe(false);
    inspect("fixture", 4000, 50);
    expect(interact(null, { kind: "scroll", x: 0, y: 100 }, location.origin).ok).toBe(true);
    expect(interact(null, { kind: "scroll", x: 0, y: 100 }, location.origin).ok).toBe(false);
    expect(scroll).toHaveBeenCalledTimes(1);
  });
  it("rejects password fields after a page changes an inspected input type", () => {
    document.body.innerHTML = '<input aria-label="Input">';
    const target = inspect("fixture", 4000, 50).interactive[0].target;
    document.querySelector("input")!.type = "password";
    expect(interact(target, { kind: "fill", text: "secret" }, location.origin).ok).toBe(false);
    expect(document.querySelector("input")!.value).toBe("");
  });
});

describe("semantic review snapshot", () => {
  it("rejects an account or reviewed body change before dispatching a click", () => {
    document.body.innerHTML = '<button>Send</button>';
    const click = script("browser_inspection_click");
    const send = vi.fn();
    document.querySelector("button")!.addEventListener("click", send);
    let observation = { account: "owner@example.com", draft: { text: "Reviewed body" } };
    const snapshot = inspect("review", 4000, 50, () => observation);
    observation = { account: "other@example.com", draft: { text: "Reviewed body" } };
    expect(click(snapshot.interactive[0].target).errorCode).toBe("browser_snapshot_stale");
    expect(send).not.toHaveBeenCalled();
    const fresh = inspect("fresh", 4000, 50, () => observation);
    observation.draft.text = "Changed body";
    expect(click(fresh.interactive[0].target).errorCode).toBe("browser_snapshot_stale");
    expect(send).not.toHaveBeenCalled();
  });
  it("consumes the snapshot before sending even if the page has not updated", () => {
    document.body.innerHTML = '<button>Send</button>';
    const click = script("browser_inspection_click");
    const send = vi.fn();
    document.querySelector("button")!.addEventListener("click", send);
    const snapshot = inspect("once", 4000, 50, () => ({ account: "owner@example.com" }));
    expect(click(snapshot.interactive[0].target).ok).toBe(true);
    expect(click(snapshot.interactive[0].target).ok).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("browser mouse activation", () => {
  it.each(["click", "point"])("%s opens a mouse-down menu and dispatches one click", (kind) => {
    document.body.innerHTML = '<button aria-label="New">New</button>';
    const button = document.querySelector("button")!;
    const events: string[] = [];
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) button.addEventListener(type, () => events.push(type));
    button.addEventListener("mousedown", () => button.setAttribute("aria-expanded", "true"));
    const target = inspect("fixture", 4000, 50).interactive[0].target;
    if (kind === "point") Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => button });
    try {
      const result = kind === "click" ? script("browser_inspection_click")(target) : interact(null, {kind:"point",x:0.5,y:0.5},location.origin);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(button.getAttribute("aria-expanded")).toBe("true");
      expect(events).toEqual(["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
      expect(script("browser_inspection_click")(target).ok).toBe(false);
      expect(events).toHaveLength(5);
    } finally { if (kind === "point") delete (document as any).elementFromPoint; }
  });
  it("does not retarget a click when a mouse-down handler removes the reviewed control", () => {
    document.body.innerHTML = '<button>Remove</button>';
    const button=document.querySelector("button")!;
    const clicked=vi.fn(); button.addEventListener("click",clicked);
    button.addEventListener("mousedown",()=>button.remove());
    const target=inspect("fixture",4000,50).interactive[0].target;
    expect(script("browser_inspection_click")(target).ok).toBe(true);
    expect(clicked).not.toHaveBeenCalled();
  });
});

it("opens a folder whose key handler reads legacy keyCode without synthesizing a second click", () => {
  document.body.innerHTML='<div role="button" tabindex="0">Catalog folder</div>';
  const folder=document.querySelector("div")!;
  const open=vi.fn(); const clicked=vi.fn();
  folder.addEventListener("keydown",event=>{ if(event.keyCode===13)open(); });
  folder.addEventListener("click",clicked);
  const target=inspect("fixture",4000,50).interactive[0].target;
  expect(interact(target,{kind:"key",key:"Enter"},location.origin)).toEqual({ok:true,attempted:true});
  expect(open).toHaveBeenCalledTimes(1); expect(clicked).not.toHaveBeenCalled();
});
