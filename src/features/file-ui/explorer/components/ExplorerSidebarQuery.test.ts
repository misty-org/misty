import { describe, expect, it } from "vitest";
import { smartFolderQueryFromRules } from "./ExplorerSidebarQuery";

describe("smart-folder query values", () => {
  it.each(["C:\\My Files\\", 'name" OR hidden:true', 'a\\"b', '"quoted"'])(
    "keeps %s inside a single escaped token",
    (value) => {
      const query = smartFolderQueryFromRules([{ field: "path", operator: "is", value }], "all");
      expect(JSON.parse(query.slice("path:".length))).toBe(value);
    },
  );

  it("preserves unquoted simple values and explicit rule joins", () => {
    expect(
      smartFolderQueryFromRules(
        [
          { field: "extension", operator: "is", value: ".pdf" },
          { field: "tag", operator: "is", value: "work" },
        ],
        "any",
      ),
    ).toBe("ext:pdf OR tag:work");
  });
});
