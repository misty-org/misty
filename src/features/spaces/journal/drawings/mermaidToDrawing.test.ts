import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  convert: vi.fn(),
  readScene: vi.fn(),
  applyScene: vi.fn(),
}));

vi.mock("@excalidraw/mermaid-to-excalidraw", () => ({ parseMermaidToExcalidraw: mocks.parse }));
vi.mock("@excalidraw/excalidraw", () => ({ convertToExcalidrawElements: mocks.convert }));
vi.mock("./api/api", () => ({
  drawingsApi: { readScene: mocks.readScene, applyScene: mocks.applyScene },
}));

import { MermaidDiagramError, mermaidToDrawing } from "./mermaidToDrawing";

describe("mermaidToDrawing", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it("converts the diagram and applies it under the board's content through the scene route", async () => {
    const skeletons = [{ type: "rectangle", x: 0, y: 0, width: 10, height: 10 }];
    mocks.parse.mockResolvedValue({ elements: skeletons });
    mocks.convert.mockReturnValue([
      { id: "a", type: "rectangle", x: 5, y: 5, width: 100, height: 40 },
      { id: "b", type: "arrow", x: 50, y: 45, width: 0, height: 60 },
    ]);
    mocks.readScene.mockResolvedValue({
      content_hash: "h".repeat(64),
      elements: [{ id: "old", type: "rectangle", x: 200, y: 100, width: 50, height: 300 }],
    });
    mocks.applyScene.mockResolvedValue({
      ok: true,
      revision: 2,
      content_hash: "n".repeat(64),
      changed: 2,
      deleted: 0,
      element_count: 3,
    });

    const result = await mermaidToDrawing("space-1", "drw-1", "flowchart TD\n A-->B", {
      idempotencyKey: "call-1",
    });

    expect(mocks.parse).toHaveBeenCalledWith("flowchart TD\n A-->B", expect.anything());
    expect(mocks.convert).toHaveBeenCalledWith(skeletons, { regenerateIds: true });
    expect(mocks.applyScene).toHaveBeenCalledTimes(1);
    const [space, drawing, change, key] = mocks.applyScene.mock.calls[0]!;
    expect([space, drawing, key]).toEqual(["space-1", "drw-1", "call-1:0"]);
    expect(change.mode).toBe("merge");
    expect(change.base_hash).toBe("h".repeat(64));
    // Placed at the board's left edge, 80 under its lowest element.
    expect(change.elements[0]).toMatchObject({ id: "a", x: 200, y: 480 });
    expect(change.elements[1]).toMatchObject({ id: "b", x: 245, y: 520 });
    expect(result).toMatchObject({ revision: 2, element_count: 3, added: 2 });
  });

  it("refuses diagrams that only draw as a picture", async () => {
    mocks.parse.mockResolvedValue({ elements: [{ type: "image" }], files: { f: {} } });
    await expect(mermaidToDrawing("s", "d", 'pie\n "a": 1')).rejects.toBeInstanceOf(
      MermaidDiagramError,
    );
    expect(mocks.applyScene).not.toHaveBeenCalled();
  });

  it("explains a diagram Mermaid can't read", async () => {
    mocks.parse.mockRejectedValue(new Error("Parse error on line 1"));
    await expect(mermaidToDrawing("s", "d", "nonsense")).rejects.toThrow("Parse error on line 1");
  });
});
