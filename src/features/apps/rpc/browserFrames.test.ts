import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";

const script = (name: string) => Function(`return (${readFileSync(`${process.cwd()}/src-tauri/src/infra/${name}.js`, "utf8")})`)();
const inspect = script("browser_inspection_snapshot");
const interact = script("browser_inspection_interact");
const frameWith = (html: string) => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  frame.contentDocument!.body.innerHTML = html;
  return frame;
};
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  delete (window as any).__MISTY_AGENT_INPUT_LOCKED__;
  delete (window as any)[Symbol.for("misty.browser.inspection")];
  delete (window as any)[Symbol.for("misty.browser.inspection.document")];
  (window as any)[Symbol.for("misty.browser.agent.cursor")]?.hide();
  delete (window as any)[Symbol.for("misty.browser.agent.cursor")];
  document.querySelector("misty-agent-cursor")?.remove();
});

it("activates a reviewed framed button once and positions the cursor in the parent viewport", () => {
  const frame = frameWith("<button>Insert image</button>");
  const button = frame.contentDocument!.querySelector("button")!;
  const click = vi.fn();
  button.addEventListener("click", click);
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue({ left: 10, top: 20, width: 10, height: 10 } as DOMRect);
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({ left: 120, top: 90, width: 200, height: 100 } as DOMRect);
  Object.defineProperties(frame, { offsetWidth: { value: 100 }, offsetHeight: { value: 50 }, clientLeft: { value: 1 }, clientTop: { value: 2 } });
  Function(readFileSync(`${process.cwd()}/src-tauri/src/infra/browser_agent_cursor.js`, "utf8"))();
  const target = inspect("click", 4000, 50).interactive[0].target;
  expect(script("browser_inspection_click")(target).ok).toBe(true);
  expect(click).toHaveBeenCalledOnce();
  expect((document.querySelector("misty-agent-cursor") as HTMLElement).style.transform).toBe("translate3d(150px,142px,0)");
});

it("inspects and fills controls in the accessible frame's own realm", () => {
  document.body.innerHTML = '<span id="label">Wrong parent label</span>';
  const frame = frameWith('<span id="label">Document title</span><input aria-labelledby="label"><textarea aria-label="Document text"></textarea>');
  const input = frame.contentDocument!.querySelector("input")!;
  const changed = vi.fn();
  input.addEventListener("input", changed);
  let snapshot = inspect("one", 4000, 50);
  expect(snapshot.interactive.map((item: any) => item.name)).toEqual(["Document title", "Document text"]);
  expect(interact(snapshot.interactive[0].target, { kind: "fill", text: "NORTHLINE" }, location.origin).ok).toBe(true);
  expect(input.value).toBe("NORTHLINE");
  expect(changed).toHaveBeenCalledOnce();
  snapshot = inspect("two", 4000, 50);
  expect(script("browser_inspection_type")(snapshot.interactive[1].target, "Catalog draft").ok).toBe(true);
  expect(frame.contentDocument!.querySelector("textarea")!.value).toBe("Catalog draft");
});

it.each(["fill", "type"])("%s edits a framed rich editor using its selection and editing transaction", kind => {
  const frame = frameWith('<div contenteditable="true" role="textbox" aria-label="Document content"></div>');
  const owner = frame.contentDocument!;
  const view = frame.contentWindow as Window & typeof globalThis;
  const editor = owner.querySelector("div")!;
  Object.defineProperty(editor, "isContentEditable", { value: true });
  Object.defineProperty(editor, "innerText", { get: () => editor.textContent });
  (window as any).__MISTY_AGENT_INPUT_LOCKED__ = true;
  (view as any).__MISTY_AGENT_INPUT_LOCKED__ = true;
  const insert = vi.fn((_command, _ui, text) => {
    expect(view.getSelection()?.anchorNode?.ownerDocument).toBe(owner);
    expect((view as any).__MISTY_AGENT_INPUT_LOCKED__).toBe(false);
    expect((window as any).__MISTY_AGENT_INPUT_LOCKED__).toBe(true);
    editor.textContent = text;
    return true;
  });
  Object.defineProperty(owner, "execCommand", { configurable: true, value: insert });
  const target = inspect("draft", 4000, 50).interactive[0].target;
  const result = kind === "fill"
    ? interact(target, { kind: "fill", text: "Catalog body" }, location.origin)
    : script("browser_inspection_type")(target, "Catalog body");
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(insert).toHaveBeenCalledOnce();
  expect((view as any).__MISTY_AGENT_INPUT_LOCKED__).toBe(true);
});

it("reports a consumed editing transaction without claiming saved content or repeating it", () => {
  const frame = frameWith('<div contenteditable="true" role="textbox" aria-label="Document content"></div>');
  const owner = frame.contentDocument!;
  const editor = owner.querySelector("div")!;
  Object.defineProperty(editor, "isContentEditable", { value: true });
  Object.defineProperty(editor, "innerText", { get: () => editor.textContent });
  const inserted: string[] = [];
  Object.defineProperty(owner, "execCommand", { configurable: true, value: (_command: string, _ui: boolean, text: string) => {
    inserted.push(text);
    editor.textContent = "\u200b\u200b";
    return true;
  } });
  const target = inspect("consumed", 4000, 50).interactive[0].target;
  expect(interact(target, { kind: "fill", text: "Catalog body" }, location.origin)).toEqual({
    ok: true, attempted: true, textRetained: false, websiteEditVerified: false,
  });
  expect(interact(target, { kind: "fill", text: "Catalog body" }, location.origin).ok).toBe(false);
  expect(inserted).toEqual(["Catalog body"]);
});

it.each(["click", "fill", "type", "upload"])("rejects %s when its inspected frame is removed", kind => {
  const frame = frameWith(kind === "upload" ? '<input type="file">' : '<input aria-label="Document">');
  const target = inspect("frame", 4000, 50).interactive[0].target;
  frame.remove();
  const result = kind === "click" ? script("browser_inspection_click")(target)
    : kind === "fill" ? interact(target, { kind: "fill", text: "Changed" }, location.origin)
    : kind === "type" ? script("browser_inspection_type")(target, "Changed")
    : script("browser_inspection_upload")(target, { documentId: "frame" }, location.origin);
  expect(result.errorCode).toBe("browser_snapshot_stale");
});

it("rejects a frame document replacement and skips inaccessible or hidden frames", () => {
  document.body.innerHTML = "<button>Parent control</button>";
  const frame = frameWith("<button>Frame control</button>");
  const target = inspect("frame", 4000, 50).interactive[1].target;
  vi.spyOn(frame, "contentDocument", "get").mockImplementation(() => { throw new DOMException("Cross-origin", "SecurityError"); });
  expect(script("browser_inspection_click")(target).errorCode).toBe("browser_snapshot_stale");
  const hidden = frameWith("<button>Hidden frame control</button>");
  hidden.hidden = true;
  expect(inspect("safe", 4000, 50).interactive.map((item: any) => item.name)).toEqual(["Parent control"]);
});

it("dispatches an uploaded task file through the frame's File and DataTransfer constructors", () => {
  const frame = frameWith('<input type="file" style="display:none">');
  const view = frame.contentWindow as Window & typeof globalThis;
  const input = frame.contentDocument!.querySelector("input")!;
  class FrameTransfer {
    files: File[] = [];
    items = { add: (file: File) => this.files.push(file) };
  }
  Object.defineProperty(view, "DataTransfer", { value: FrameTransfer });
  let selected: File[] = [];
  Object.defineProperty(input, "files", { get: () => selected, set: files => { selected = files; } });
  const changed = vi.fn();
  input.addEventListener("change", changed);
  const target = inspect("upload", 4000, 50).interactive[0].target;
  const result = script("browser_inspection_upload")(target, { documentId: "upload", file: { base64: "YWJj", byteSize: 3, name: "mockup.png", mimeType: "image/png" } }, location.origin);
  expect(result).toMatchObject({ ok: true, inputSelected: true, websiteUploadVerified: false });
  expect(selected[0]).toBeInstanceOf(view.File);
  expect(changed).toHaveBeenCalledOnce();
});

it("maps a viewport point into a scaled frame and dispatches once on its actual control", () => {
  const frame = frameWith('<button>Select mockup</button>');
  const owner = frame.contentDocument!;
  const button = owner.querySelector('button')!;
  vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 50, width: 400, height: 200 } as DOMRect);
  Object.defineProperties(frame, { offsetWidth: { value: 200 }, offsetHeight: { value: 100 }, clientLeft: { value: 1 }, clientTop: { value: 2 } });
  const rootHit = vi.fn(() => frame), childHit = vi.fn(() => button), clicked = vi.fn();
  const prior = document.elementFromPoint;
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: rootHit });
  Object.defineProperty(owner, 'elementFromPoint', { configurable: true, value: childHit });
  button.addEventListener('click', clicked);
  try {
    inspect('point', 4000, 50);
    expect(interact(null, { kind: 'point', x: 142 / innerWidth, y: 94 / innerHeight }, location.origin).ok).toBe(true);
    expect(childHit).toHaveBeenCalledWith(20, 20);
    expect(clicked).toHaveBeenCalledOnce();
    expect(clicked.mock.calls[0][0]).toBeInstanceOf((frame.contentWindow as Window & typeof globalThis).MouseEvent);
    expect(clicked.mock.calls[0][0].clientX).toBe(20);
  } finally {
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: prior });
  }
});

it("does not dispatch a point into an inaccessible frame", () => {
  const frame = frameWith('<button>Private</button>');
  const clicked = vi.fn();
  frame.addEventListener('click', clicked);
  const prior = document.elementFromPoint;
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => frame });
  vi.spyOn(frame, 'contentDocument', 'get').mockReturnValue(null);
  try {
    inspect('point', 4000, 50);
    expect(interact(null, { kind: 'point', x: 0.5, y: 0.5 }, location.origin).ok).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: prior });
  }
});

it("scrolls the editor viewport containing an accessible frame and reports movement", () => {
  const viewport = document.createElement('div');
  viewport.style.overflowY = 'auto';
  viewport.setAttribute('aria-label', 'Catalog pages');
  document.body.append(viewport);
  const frame = document.createElement('iframe');
  viewport.append(frame);
  frame.contentDocument!.body.innerHTML = '<div role="textbox" contenteditable="true" aria-label="Document content"></div>';
  Object.defineProperties(viewport, { scrollHeight: { value: 1800 }, clientHeight: { value: 400 } });
  const scroll = vi.fn(({ top }) => { viewport.scrollTop += top; });
  viewport.scrollBy = scroll;
  let snapshot = inspect('scroll', 4000, 50);
  expect(snapshot.interactive.some((item: any) => item.name === 'Scrollable area: Catalog pages')).toBe(true);
  const target = snapshot.interactive.find((item: any) => item.name === 'Document content').target;
  expect(interact(target, { kind: 'scroll', x: 0, y: 600 }, location.origin)).toEqual({ ok: true, attempted: true, scrolled: true });
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ left: 0, top: 600, behavior: 'instant' });
  expect(viewport.scrollTop).toBe(600);
  snapshot = inspect('edge', 4000, 50);
  viewport.scrollBy = vi.fn();
  expect(interact(snapshot.interactive[0].target, { kind: 'scroll', x: 0, y: 600 }, location.origin).scrolled).toBe(false);
});

it("does not claim scrolling or target an unrelated viewport when no ancestor can scroll", () => {
  document.body.innerHTML = '<button>Fixed toolbar</button><div style="overflow-y:auto" aria-label="Other pane"></div>';
  const unrelated = document.querySelector('div')!;
  Object.defineProperties(unrelated, { scrollHeight: { value: 1000 }, clientHeight: { value: 300 } });
  unrelated.scrollBy = vi.fn();
  const target = inspect('fixed', 4000, 50).interactive[0].target;
  expect(interact(target, { kind: 'scroll', x: 0, y: 300 }, location.origin)).toEqual({ ok: true, attempted: true, scrolled: false });
  expect(unrelated.scrollBy).not.toHaveBeenCalled();
});
