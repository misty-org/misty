import { describe, expect, it } from "vitest";
import { dataSha256, loadTasks, selectTasks } from "../tasks.ts";

const tasks = loadTasks();
const count = (split: string, level?: string) => tasks.filter((task) => task.split === split && (!level || task.level === level)).length;

describe("task splits", () => {
  it("keeps the data file it was fixed on", () => {
    expect(tasks).toHaveLength(200);
    expect(dataSha256()).toBe("0bb7081d740eb6237b72e7e33524cc9489e769c5e236ec54879a8eb06ebc48e0");
  });

  it("splits by level in the benchmark's own proportions", () => {
    expect([count("dev"), count("holdout"), count("rest")]).toEqual([40, 60, 100]);
    expect(["easy", "medium", "hard"].map((level) => count("dev", level))).toEqual([9, 9, 22]);
    expect(["easy", "medium", "hard"].map((level) => count("holdout", level))).toEqual([13, 14, 33]);
    expect(["easy", "medium", "hard"].map((level) => count("rest", level))).toEqual([23, 23, 54]);
  });

  it("is the campaign's split: tasks its log names as dev are still dev", () => {
    const dev = selectTasks(tasks, "dev", []);
    for (const prefix of ["46ecc9a5dc", "8f005e9f09", "341d7a7056", "48a6cb73b8", "adc644f33f", "4614aa0831", "42e2344431", "5e09c06aa9", "d03a08650b"])
      expect(dev.some((task) => task.id.startsWith(prefix)), prefix).toBe(true);
  });

  it("orders tasks the same way every time", () => {
    expect(loadTasks().map((task) => task.id)).toEqual(tasks.map((task) => task.id));
  });

  it("selects by split or by id prefix, and refuses an unknown split", () => {
    expect(selectTasks(tasks, "all", [])).toHaveLength(200);
    expect(selectTasks(tasks, "dev", ["46ecc9a5dc"]).map((task) => task.id.slice(0, 10))).toEqual(["46ecc9a5dc"]);
    expect(() => selectTasks(tasks, "devv", [])).toThrow("MISTY_ODYSSEYS_SPLIT");
  });

  it("gives every task rubrics to grade", () => {
    expect(tasks.every((task) => task.rubrics.length >= 3 && task.prompt.length > 0)).toBe(true);
  });
});
