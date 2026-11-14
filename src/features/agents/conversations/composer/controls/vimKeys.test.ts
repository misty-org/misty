import { describe, expect, it } from "vitest";
import { vimKey, vimStart, type VimState } from "./vimKeys";

/** Types `keys` one by one from `caret`, starting in normal mode unless told otherwise. */
function run(text: string, caret: number, keys: string[], state?: Partial<VimState>) {
  let edit = { text, caret, state: { ...vimStart(), mode: "normal" as const, ...state } };
  for (const key of keys) {
    const next = vimKey(key, edit.text, edit.caret, edit.state);
    if (next) edit = { ...next, state: next.state as typeof edit.state };
  }
  return edit;
}

describe("vimKey", () => {
  it("leaves insert mode alone except for Escape", () => {
    const state = vimStart();
    expect(vimKey("a", "hi", 2, state)).toBeNull();
    const out = vimKey("Escape", "hi", 2, state);
    expect(out?.state.mode).toBe("normal");
    expect(out?.caret).toBe(1);
  });

  it("lets Enter, arrows and Tab through in normal mode", () => {
    const state = { ...vimStart(), mode: "normal" as const };
    expect(vimKey("Enter", "hi", 0, state)).toBeNull();
    expect(vimKey("ArrowUp", "hi", 0, state)).toBeNull();
  });

  it("moves by characters, words and lines", () => {
    expect(run("hello world", 0, ["w"]).caret).toBe(6);
    expect(run("hello world", 8, ["b"]).caret).toBe(6);
    expect(run("hello world", 0, ["e"]).caret).toBe(4);
    expect(run("hello world", 3, ["$"]).caret).toBe(10);
    expect(run("  indented", 9, ["^"]).caret).toBe(2);
    expect(run("one\ntwo", 1, ["j"]).caret).toBe(5);
    expect(run("one\ntwo", 5, ["k"]).caret).toBe(1);
    expect(run("one\ntwo", 5, ["g", "g"]).caret).toBe(0);
  });

  it("deletes, changes and yanks", () => {
    expect(run("hello world", 0, ["d", "w"]).text).toBe("world");
    expect(run("one\ntwo\nthree", 5, ["d", "d"]).text).toBe("one\nthree");
    expect(run("hello", 0, ["x"]).text).toBe("ello");
    expect(run("hello world", 6, ["D"]).text).toBe("hello ");
    const changed = run("hello world", 0, ["c", "w"]);
    expect(changed.text).toBe(" world");
    expect(changed.state.mode).toBe("insert");
    const yanked = run("one\ntwo", 0, ["y", "y", "j", "p"]);
    expect(yanked.text).toBe("one\ntwo\none");
  });

  it("enters insert mode where each key says", () => {
    expect(run("abc", 1, ["a"]).caret).toBe(2);
    expect(run("abc", 1, ["A"]).caret).toBe(3);
    expect(run("  abc", 4, ["I"]).caret).toBe(2);
    const opened = run("abc", 1, ["o"]);
    expect(opened.text).toBe("abc\n");
    expect(opened.caret).toBe(4);
  });

  it("undoes the last change", () => {
    expect(run("hello", 0, ["x", "x", "u"]).text).toBe("ello");
  });

  it("types nothing for other keys in normal mode", () => {
    const out = run("abc", 0, ["z", "q"]);
    expect(out.text).toBe("abc");
  });
});
