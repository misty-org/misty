import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPromptHistory,
  findPromptCompletion,
  getPromptHistory,
  recordPrompt,
  setPromptHistoryEnabled,
} from "./promptHistory";
import { usePromptHistoryNav } from "./usePromptHistoryNav";

const key = (name: string) => ({
  key: name,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  preventDefault: () => undefined,
});

describe("prompt history", () => {
  beforeEach(() => {
    clearPromptHistory();
    setPromptHistoryEnabled(true);
  });

  it("keeps each prompt once, newest last, trimmed", () => {
    recordPrompt(" first ");
    recordPrompt("second");
    recordPrompt("first");
    expect(getPromptHistory()).toEqual(["second", "first"]);
  });

  it("completes a prefix with the most used prompt", () => {
    recordPrompt("run the tests");
    recordPrompt("run the build");
    recordPrompt("run the build");
    expect(findPromptCompletion("run")).toBe("run the build");
    expect(findPromptCompletion("r")).toBeNull();
  });

  it("walks back and forth from an empty box and restores the draft", () => {
    recordPrompt("one");
    recordPrompt("two");
    let text = "";
    const { result } = renderHook(() =>
      usePromptHistoryNav({ getText: () => text, setText: (next) => (text = next) }),
    );
    act(() => void result.current.handleKeyDown(key("ArrowUp")));
    expect(text).toBe("two");
    act(() => void result.current.handleKeyDown(key("ArrowUp")));
    expect(text).toBe("one");
    act(() => void result.current.handleKeyDown(key("ArrowDown")));
    expect(text).toBe("two");
    act(() => void result.current.handleKeyDown(key("ArrowDown")));
    expect(text).toBe("");
  });

  it("leaves a box with text, Down, and modified keys alone", () => {
    recordPrompt("one");
    let text = "typed";
    const { result } = renderHook(() =>
      usePromptHistoryNav({ getText: () => text, setText: (next) => (text = next) }),
    );
    expect(result.current.handleKeyDown(key("ArrowUp"))).toBe(false);
    text = "";
    expect(result.current.handleKeyDown(key("ArrowDown"))).toBe(false);
    expect(result.current.handleKeyDown({ ...key("ArrowUp"), shiftKey: true })).toBe(false);
  });
});
