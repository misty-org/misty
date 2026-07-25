import { describe, expect, it } from "vitest";
import {
  explorerPathKey,
  explorerPathName,
  joinExplorerPath,
  normalizeExplorerPath,
} from "@/features/explorer/utils/pathNormalization";
import { breadcrumbSegments } from "@/features/explorer/utils/fileFormat";
import { parentDirectory } from "@/features/explorer/store/helpers/listing";
import { createMultiPanelStore } from "@/features/workspace";

describe("explorer path normalization", () => {
  it("canonicalizes Windows drive paths for frontend state", () => {
    expect(normalizeExplorerPath("c:\\Users\\Misty\\Documents\\")).toBe("C:/Users/Misty/Documents");
    expect(normalizeExplorerPath("C:\\")).toBe("C:/");
    expect(explorerPathName("C:\\Users\\Misty\\Documents")).toBe("Documents");
  });

  it("strips Windows verbatim path prefixes before storing paths", () => {
    expect(normalizeExplorerPath("\\\\?\\C:\\Users\\Misty\\Desktop\\")).toBe(
      "C:/Users/Misty/Desktop",
    );
    expect(normalizeExplorerPath("//?/C:/Users/Misty/Desktop")).toBe("C:/Users/Misty/Desktop");
    expect(normalizeExplorerPath("\\\\?\\UNC\\server\\share\\folder")).toBe(
      "//server/share/folder",
    );
  });

  it("preserves UNC roots while normalizing their separators", () => {
    expect(normalizeExplorerPath("\\\\server\\share\\folder\\")).toBe("//server/share/folder");
    expect(joinExplorerPath("\\\\server\\share", "folder", "report.pdf")).toBe(
      "//server/share/folder/report.pdf",
    );
  });

  it("builds Windows drive breadcrumbs from the drive root", () => {
    expect(breadcrumbSegments("//?/C:/Users/Misty")).toEqual([
      { label: "C:", path: "C:/" },
      { label: "Users", path: "C:/Users" },
      { label: "Misty", path: "C:/Users/Misty" },
    ]);
  });

  it("keeps Windows drive roots intact when resolving parents", () => {
    expect(parentDirectory("C:/")).toBe("C:/");
    expect(parentDirectory("C:/Users")).toBe("C:/");
    expect(parentDirectory("C:/Users/Misty")).toBe("C:/Users");
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
