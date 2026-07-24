import { describe, expect, it } from "vitest";
import {
  explorerPathKey,
  explorerPathName,
  joinExplorerPath,
  normalizeExplorerPath,
} from "@/features/explorer/utils/pathNormalization";
import { createMultiPanelStore } from "@/features/workspace";

describe("explorer path normalization", () => {
  it("canonicalizes Windows drive paths for frontend state", () => {
    expect(normalizeExplorerPath("c:\\Users\\Misty\\Documents\\")).toBe("C:/Users/Misty/Documents");
    expect(normalizeExplorerPath("C:\\")).toBe("C:/");
    expect(explorerPathName("C:\\Users\\Misty\\Documents")).toBe("Documents");
  });

  it("preserves UNC roots while normalizing their separators", () => {
    expect(normalizeExplorerPath("\\\\server\\share\\folder\\")).toBe("//server/share/folder");
    expect(joinExplorerPath("\\\\server\\share", "folder", "report.pdf")).toBe(
      "//server/share/folder/report.pdf",
    );
  });

  it("compares Windows paths case-insensitively", () => {
    expect(explorerPathKey("c:\\Users\\Misty\\Report.pdf")).toBe(
      explorerPathKey("C:/users/misty/report.pdf"),
    );
  });

  it("normalizes Windows paths when tabs are created and restored", () => {
    const store = createMultiPanelStore({ idPrefix: "path-test" });
    store.getState().initialize("c:\\Users\\Misty\\Documents\\", "Documents");
    expect(store.getState().tabs[0]?.path).toBe("C:/Users/Misty/Documents");
    expect(store.getState().tabs[0]?.panes[0]?.path).toBe("C:/Users/Misty/Documents");
  });
});
