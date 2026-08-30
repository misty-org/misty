import { describe, expect, it } from "vitest";
import { dockWidgetRegistry } from "./dockRegistry";
import { createCodeTabState, parseCodeTabState } from "./model";

describe("Code tab state", () => {
  it("restores a versioned file viewport through the dock registry", () => {
    const snapshot = createCodeTabState({
      rootPath: "/repo",
      viewport: { kind: "file", activeFilePath: "/repo/src/main.ts" },
      explorerWidth: 28,
    });

    expect(dockWidgetRegistry.get("code").restore(snapshot)).toEqual(snapshot);
  });

  it("sanitizes legacy or malformed snapshots", () => {
    expect(
      parseCodeTabState({
        rootPath: "",
        activeFilePath: 42,
        explorerWidth: 100,
      }),
    ).toEqual({
      version: 2,
      rootPath: null,
      viewport: { kind: "file", activeFilePath: null },
      explorerWidth: 42,
    });
  });

  it("migrates a version-one file viewport", () => {
    expect(
      parseCodeTabState({
        version: 1,
        rootPath: "/repo",
        activeFilePath: "/repo/a.ts",
        explorerWidth: 22,
      }),
    ).toEqual({
      version: 2,
      rootPath: "/repo",
      viewport: { kind: "file", activeFilePath: "/repo/a.ts" },
      explorerWidth: 22,
    });
  });

  it("restores reproducible multibuffer specs and expires mutations", () => {
    const restored = parseCodeTabState({
      version: 2,
      rootPath: "/repo",
      explorerWidth: 22,
      viewport: {
        kind: "multibuffer",
        spec: {
          id: "rename:1",
          kind: "rename",
          title: "Rename: a → b",
          origin: { path: "/repo/a.ts", line: 1, character: 2 },
          expired: false,
        },
      },
    });

    expect(restored.viewport).toEqual({
      kind: "multibuffer",
      spec: {
        id: "rename:1",
        kind: "rename",
        title: "Rename: a → b",
        origin: { path: "/repo/a.ts", line: 1, character: 2 },
        expired: true,
      },
    });
  });
});
