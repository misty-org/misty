import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lspExtension, showSymbolInformation } from "./codeMirrorLsp";

const lspMocks = vi.hoisted(() => ({
  request: vi.fn(async (method: string) =>
    method === "textDocument/hover" ? { contents: { value: "const answer: number" } } : null,
  ),
  getLspClient: vi.fn(),
}));

vi.mock("./useLsp", () => ({
  languageFor: () => "typescript",
  getLspClient: lspMocks.getLspClient,
}));

describe("Code symbol information", () => {
  afterEach(() => {
    lspMocks.request.mockClear();
    lspMocks.getLspClient.mockReset();
  });

  it("requests hover information and exposes it as a keyboard-opened tooltip", async () => {
    lspMocks.getLspClient.mockResolvedValue({
      request: lspMocks.request,
      didOpen: vi.fn(async () => undefined),
      didChange: vi.fn(async () => undefined),
      didClose: vi.fn(async () => undefined),
      onMessage: vi.fn(() => () => undefined),
    });
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "const answer = 42;",
        selection: { anchor: 8 },
        extensions: lspExtension("/project/example.ts", "/project", "code-tab"),
      }),
    });

    await expect(showSymbolInformation(view, "/project/example.ts", "/project")).resolves.toBe(
      true,
    );
    expect(lspMocks.request).toHaveBeenCalledWith("textDocument/hover", {
      textDocument: { uri: "file:///project/example.ts" },
      position: { line: 0, character: 8 },
    });
    expect(view.state.field).toBeTruthy();

    view.destroy();
    host.remove();
  });
});
