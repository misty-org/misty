import { describe, expect, it } from "vitest";
import { dockWidgetRegistry } from "./dockRegistry";
import { createCodeTabState, parseCodeTabState } from "./model";

describe("Code tab state", () => {
  it("restores a versioned file viewport through the dock registry", () => {
    const snapshot = createCodeTabState({
      rootPath: "/repo",
      activeFilePath: "/repo/src/main.ts",
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
      version: 1,
      rootPath: null,
      activeFilePath: null,
      explorerWidth: 42,
    });
  });
});
