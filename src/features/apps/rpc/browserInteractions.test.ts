import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const script = (name: string) =>
  Function(`return (${readFileSync(`${process.cwd()}/src-tauri/src/infra/${name}.js`, "utf8")})`)();
const inspect = script("browser_inspection_snapshot");
const interact = script("browser_inspection_interact");
afterEach(() => {
  document.body.innerHTML = "";
  delete (window as any)[Symbol.for("misty.browser.inspection")];
  delete (window as any)[Symbol.for("misty.browser.inspection.document")];
});

describe("native browser interaction fixtures", () => {
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
