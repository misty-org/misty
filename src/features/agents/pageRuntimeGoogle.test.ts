// @vitest-environment-options {"url":"https://docs.google.com/document/d/doc123/edit"}
import { afterEach, describe, expect, it, vi } from "vitest";
import core from "../../../src-tauri/src/infra/browser/page_agent/page_core.js?raw";
import tree from "../../../src-tauri/src/infra/browser/page_agent/page_tree.js?raw";
import actions from "../../../src-tauri/src/infra/browser/page_agent/page_actions.js?raw";
import read from "../../../src-tauri/src/infra/browser/page_agent/page_read.js?raw";
import skills from "../../../src-tauri/src/infra/browser/page_agent/page_skills.js?raw";

// The Google Docs and Sheets skills (page_skills.js), loaded into jsdom at a
// docs.google.com address. Docs takes input in a hidden text field and its own
// shortcuts; both apps are read through Google's own export of the saved file.
type Page = { call: (operation: string, args?: Record<string, unknown>) => any };
const globals = globalThis as unknown as { __mistyAgentPageV1?: Page };

function load(path: string, html: string): { page: Page; documentId: string } {
  history.replaceState(null, "", path);
  document.body.innerHTML = html;
  delete globals.__mistyAgentPageV1;
  new Function(`${core}\n${tree}\n${actions}\n${read}\n${skills}`)();
  const page = globals.__mistyAgentPageV1!;
  const snapshot = page.call("snapshot", { candidateId: "doc-1", maxChars: 20000 });
  return { page, documentId: snapshot.documentId };
}

const skill = (page: Page, documentId: string, id: string, action: string, args = {}) =>
  page.call("skill", { documentId, skill: id, action, args });

function exportServer(body: string) {
  const requested: string[] = [];
  class FakeRequest {
    status = 0;
    responseText = "";
    private url = "";
    open(_method: string, url: string, asynchronous: boolean) {
      expect(asynchronous).toBe(false);
      this.url = url;
    }
    send() {
      requested.push(this.url);
      this.status = 200;
      this.responseText = body;
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeRequest);
  return requested;
}

afterEach(() => vi.unstubAllGlobals());

describe("Google Docs skill", () => {
  it("is offered on Docs instead of the generic editor, whose paste Docs ignores", () => {
    const { page } = load(
      "/document/d/doc123/edit",
      `<iframe class="docs-texteventtarget-iframe"></iframe>`,
    );
    const ids = page
      .call("snapshot", { candidateId: "doc-2", maxChars: 20000 })
      .skills.map((s: { id: string }) => s.id);
    expect(ids).toContain("google-docs");
    expect(ids).not.toContain("editor");
  });

  it("writes headings, lists and bold through the hidden text field and Docs' shortcuts", () => {
    const { page, documentId } = load(
      "/document/d/doc123/edit",
      `<iframe class="docs-texteventtarget-iframe"></iframe>`,
    );
    const frame = document.querySelector<HTMLIFrameElement>(".docs-texteventtarget-iframe")!;
    const input = frame.contentDocument!;
    const seen: string[] = [];
    input.execCommand = vi.fn((command: string, _ui?: boolean, text?: string) => {
      seen.push(`${command}:${text}`);
      return true;
    }) as typeof input.execCommand;
    input.body.addEventListener("keydown", (event) => {
      const mods = ["ctrlKey", "metaKey", "altKey", "shiftKey"]
        .filter((mod) => event[mod as keyof KeyboardEvent])
        .map((mod) => mod.replace("Key", ""))
        .join("+");
      seen.push(`key:${mods ? `${mods}+` : ""}${event.key}`);
    });
    const result = skill(page, documentId, "google-docs", "write", {
      markdown: "# Answer\n- one\n- two\nPlain **bold** end",
    });
    expect(result).toMatchObject({ ok: true, attempted: true, via: "keyboard", paragraphs: 4 });
    // jsdom reports no Mac, so Docs' shortcuts use Ctrl.
    expect(seen).toEqual([
      "key:ctrl+End",
      "key:Enter",
      "key:ctrl+alt+1",
      "insertText:Answer",
      "key:Enter",
      "key:ctrl+alt+0",
      "key:ctrl+shift+8",
      "insertText:one",
      "key:Enter",
      "key:ctrl+alt+0",
      "insertText:two",
      "key:Enter",
      "key:ctrl+shift+8",
      "key:ctrl+alt+0",
      "insertText:Plain ",
      "key:ctrl+b",
      "insertText:bold",
      "key:ctrl+b",
      "insertText: end",
    ]);
  });

  it("refuses empty writes and writes before the document loads", () => {
    let { page, documentId } = load(
      "/document/d/doc123/edit",
      `<iframe class="docs-texteventtarget-iframe"></iframe>`,
    );
    expect(skill(page, documentId, "google-docs", "write", { markdown: " " })).toMatchObject({
      ok: false,
      attempted: false,
    });
    ({ page, documentId } = load("/document/d/doc123/edit", `<p>Loading</p>`));
    expect(skill(page, documentId, "google-docs", "write", { markdown: "Hi" })).toMatchObject({
      ok: false,
      attempted: false,
    });
  });

  it("reads the saved document through Google's own export", () => {
    const requested = exportServer("﻿Essay prompt: start later?\nAnswer");
    const { page, documentId } = load(
      "/document/d/doc123/edit",
      `<iframe class="docs-texteventtarget-iframe"></iframe>`,
    );
    expect(skill(page, documentId, "google-docs", "read")).toMatchObject({
      ok: true,
      attempted: false,
      text: "Essay prompt: start later?\nAnswer",
    });
    expect(requested).toEqual(["/document/d/doc123/export?format=txt"]);
  });
});

describe("Google Sheets skill", () => {
  it("pastes through the Name box without needing the grid skill", () => {
    const { page, documentId } = load(
      "/spreadsheets/d/sheet9/edit",
      `<input id="t-name-box" aria-label="Name box" value="A1">`,
    );
    const result = skill(page, documentId, "google-sheets", "paste", {
      cell: "F1",
      rows: [["Total"], ["=SUM(B2:E2)"]],
    });
    expect(result.ok).toBe(true);
    expect(result.steps[0]).toMatchObject({ action: "fill", text: "F1", submit: true });
    expect(skill(page, documentId, "google-sheets", "goto", { cell: "B3" }).steps[0]).toMatchObject(
      { action: "fill", text: "B3" },
    );
  });

  it("reads the open tab's saved values as CSV", () => {
    const requested = exportServer("Region,Revenue\nWest,61200");
    const { page, documentId } = load(
      "/spreadsheets/d/sheet9/edit#gid=5",
      `<input id="t-name-box" aria-label="Name box">`,
    );
    expect(skill(page, documentId, "google-sheets", "read")).toMatchObject({
      ok: true,
      csv: "Region,Revenue\nWest,61200",
    });
    expect(requested).toEqual(["/spreadsheets/d/sheet9/export?format=csv&gid=5"]);
  });
});
