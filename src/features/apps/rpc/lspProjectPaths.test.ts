import { expect, it } from "vitest";
import { createLspProjectPaths } from "./lspProjectPaths";
import type { LspMessage } from "@/features/coding-workspace/lsp/client";

const root = "/misty-project/project",
  native = "/private/tmp/日本語 #? project";
const uri = (path: string) => `file://${path.split("/").map(encodeURIComponent).join("/")}`;
const paths = createLspProjectPaths(root, native);

it("translates initialization, document changes and workspace folders without touching source text", () => {
  const initialize: LspMessage = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      rootUri: uri(root),
      rootPath: root,
      workspaceFolders: [{ uri: uri(root), name: "Project" }],
    },
  };
  expect(paths.toNative(initialize).params).toEqual({
    rootUri: uri(native),
    rootPath: native,
    workspaceFolders: [{ uri: uri(native), name: "Project" }],
  });
  const change: LspMessage = {
    jsonrpc: "2.0",
    method: "textDocument/didChange",
    params: {
      textDocument: { uri: uri(`${root}/src/日本語 #?.cpp`), version: 3 },
      contentChanges: [{ text: uri(`${root}/source.cpp`) }],
    },
  };
  expect(paths.toApp(paths.toNative(change))).toEqual(change);
  expect(JSON.stringify(paths.toNative(change))).toContain(uri(`${root}/source.cpp`));
  expect(initialize.params).toHaveProperty("rootPath", root);
});
it("translates definitions, diagnostics and both workspace-edit formats", () => {
  const file = uri(`${native}/src/source.cpp`),
    appFile = uri(`${root}/src/source.cpp`);
  const response: LspMessage = {
    jsonrpc: "2.0",
    id: 2,
    result: {
      locations: [{ uri: file }, { targetUri: file }],
      changes: { [file]: [{ newText: file }] },
      documentChanges: [
        { textDocument: { uri: file, version: 3 }, edits: [] },
        { kind: "rename", oldUri: file, newUri: uri(`${native}/next.cpp`) },
      ],
      diagnostics: [
        { uri: file, relatedInformation: [{ location: { uri: file }, message: file }] },
      ],
    },
  };
  const translated = paths.toApp(response);
  expect(translated.result).toMatchObject({
    locations: [{ uri: appFile }, { targetUri: appFile }],
    changes: { [appFile]: [{ newText: file }] },
  });
  expect(paths.toNative(translated)).toEqual(response);
});
it("maps command URI arguments while preserving labels, edits, prose and non-file URIs", () => {
  const file = uri(`${native}/a.cpp`);
  const message: LspMessage = {
    jsonrpc: "2.0",
    id: 3,
    result: {
      command: { command: "server.action", arguments: [file, { uri: file, text: file }] },
      label: file,
      detail: file,
      documentation: { kind: "markdown", value: file },
      uri: "https://example.test/a",
      unrelated: file,
    },
  };
  expect(paths.toApp(message).result).toMatchObject({
    command: { arguments: [uri(`${root}/a.cpp`), { uri: uri(`${root}/a.cpp`), text: file }] },
    label: file,
    detail: file,
    documentation: { value: file },
    uri: "https://example.test/a",
    unrelated: file,
  });
});
it("does not treat prefix siblings or outside-project documents as granted project files", () => {
  for (const file of [`${native}-other/a.cpp`, "/usr/include/stdio.h"])
    expect(paths.toApp({ jsonrpc: "2.0", result: { uri: uri(file) } }).result).toEqual({
      uri: uri(file),
    });
});
it("rejects invalid roots, malformed local URIs, traversal and translation collisions", () => {
  for (const value of ["relative", "/a/../b", "/a/./b", "/a\0b", "//remote/path"])
    expect(() => createLspProjectPaths(root, value)).toThrow();
  for (const value of [
    `file://${root}/../outside`,
    `file://${root}/%2e%2e/outside`,
    `file://${root}/a%2f..%2fb`,
    `file://${root}/%FF`,
    `file://${root}/a?query`,
    "file://remote/a",
  ])
    expect(() => paths.toNative({ jsonrpc: "2.0", params: { uri: value } })).toThrow();
  expect(() =>
    paths.toNative({
      jsonrpc: "2.0",
      result: { changes: { [uri(`${root}/a`)]: [], [uri(`${native}/a`)]: [] } },
    }),
  ).toThrow("collide");
});
