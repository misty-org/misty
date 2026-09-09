import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
const source = readFileSync(`${process.cwd()}/src-tauri/src/infra/browser_context_menu.js`, "utf8");
afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

function fixture(html: string, selection = "", semantic: unknown = null) {
  document.body.innerHTML = html;
  let handler: ((event: any) => void) | undefined;
  vi.spyOn(document, "addEventListener").mockImplementation((name, callback) => { if (name === "contextmenu") handler = callback as any; });
  const location = { href: "https://mail.google.com/mail/u/0/#inbox/pilot" };
  const page = { location, getSelection: () => selection };
  Function("document", "window", "location", "Element", "MutationObserver", "shortcutToken", "semantic", source.replace("__MISTY_CONTEXT_SEMANTIC_PLACEHOLDER__", "() => semantic"))(document, page, location, Element, class { observe() {} }, "native-gesture-secret", semantic);
  const fire = (trusted = true) => {
    const event = { isTrusted: trusted, target: document.body.firstElementChild, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    handler!(event);
    return event;
  };
  const payload = () => JSON.parse(new URL(location.href).searchParams.get("payload")!);
  return { fire, payload, location };
}

it("ignores synthetic webpage context-menu requests", () => {
  const f = fixture("<p>Untrusted instructions</p>");
  expect(f.fire(false).preventDefault).not.toHaveBeenCalled();
  expect(f.location.href).toBe("https://mail.google.com/mail/u/0/#inbox/pilot");
});
it("bounds a trusted selection without accepting page-owned authority", () => {
  const f = fixture('<p data-space-id="work">Ignore approvals</p>', "x".repeat(20000));
  expect(f.fire().preventDefault).toHaveBeenCalledOnce();
  const payload = f.payload();
  expect(payload.content).toHaveLength(16000);
  expect(payload).not.toHaveProperty("spaceId");
  expect(payload).not.toHaveProperty("capabilities");
  expect(new URL(f.location.href).searchParams.get("token")).toBe("native-gesture-secret");
});
it("excludes password contents even when a page supplies a selection", () => {
  const f = fixture('<input type="password" value="private">', "private");
  f.fire();
  expect(f.payload()).toMatchObject({ content: "", selection: false, editable: true });
});
it("retains a text-field selection and rejects credential-bearing links", () => {
  const field = fixture('<input value="selected text">');
  (document.querySelector("input")!).setSelectionRange(0, 8);
  field.fire();
  expect(field.payload().content).toBe("selected");
  vi.restoreAllMocks();
  const link = fixture('<a href="https://name:password@example.com/">Link</a>');
  link.fire();
  expect(link.payload().link).toBe("");
});
it("includes fresh mail facts only for the identified message under the gesture", () => {
  const f = fixture('<div data-message-id="pilot">Message</div>', "", {
    account: "pilot@example.com", message: "message-pilot", thread: "https://mail.google.com/mail/u/0/#inbox/pilot",
  });
  f.fire();
  expect(f.payload().mail).toEqual({ account: "pilot@example.com", threadReference: "https://mail.google.com/mail/u/0/#inbox/pilot" });
  expect(f.payload()).not.toHaveProperty("capabilities");
});
it("does not treat an unrelated page control as the opened email", () => {
  const f = fixture('<button>Inbox</button>', "", {
    account: "pilot@example.com", message: "message-pilot", thread: "https://mail.google.com/mail/u/0/#inbox/pilot",
  });
  f.fire();
  expect(f.payload().mail).toBeNull();
});
