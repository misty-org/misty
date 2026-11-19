import { describe, expect, it } from "vitest";
import {
  findEmbedDirectives,
  formatEmbedDirective,
  parseEmbedAttributes,
  readEmbedDirective,
} from "./embedDirective";

describe("embed directives", () => {
  it("round-trips plain and quoted values", () => {
    const chart = { kind: "data-chart" as const, item_id: "wb_1", part_id: "chart_9" };
    expect(formatEmbedDirective(chart)).toBe("::embed{kind=data-chart id=wb_1 part=chart_9}");
    const range = {
      kind: "data-range" as const,
      item_id: "wb_1",
      part_id: "sheet_1!{r:a,c:b}:{r:c,c:d}",
      title: 'The "Q3" numbers',
    };
    const text = formatEmbedDirective(range);
    expect(text).toBe(
      '::embed{kind=data-range id=wb_1 part="sheet_1!{r:a,c:b}:{r:c,c:d}" title="The \\"Q3\\" numbers"}',
    );
    expect(readEmbedDirective(`${text}\nafter`)).toEqual({ embed: range, raw: `${text}\n` });
  });

  it("refuses unknown kinds and missing ids", () => {
    expect(parseEmbedAttributes("kind=data-table id=a part=b")).toBeNull();
    expect(parseEmbedAttributes("kind=board-frame part=b")).toBeNull();
    expect(readEmbedDirective("text ::embed{kind=board-frame id=a part=b}")).toBeNull();
  });

  it("finds every directive in markdown, in order", () => {
    const markdown = [
      "# Plan",
      "::embed{kind=board-frame id=drw_1 part=frame_a}",
      "Some text",
      "::embed{kind=data-chart id=wb_2 part=c1 title=Revenue}",
    ].join("\n");
    expect(findEmbedDirectives(markdown)).toEqual([
      { kind: "board-frame", item_id: "drw_1", part_id: "frame_a" },
      { kind: "data-chart", item_id: "wb_2", part_id: "c1", title: "Revenue" },
    ]);
  });
});
