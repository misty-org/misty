// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlobalAiMessage } from "../../state/conversationTypes";
import {
  findTimelineMatches,
  messageSearchText,
  paintSearchHighlights,
  scrollMatchIntoView,
} from "./timelineSearch";

const msg = (
  id: string,
  role: "user" | "assistant",
  content: string,
  extra: Partial<GlobalAiMessage> = {},
): GlobalAiMessage => ({
  id,
  role,
  mode: "ask",
  content,
  createdAt: "",
  ...extra,
});

describe("findTimelineMatches", () => {
  it("returns nothing for a blank query", () => {
    expect(findTimelineMatches([msg("1", "user", "hello")], "")).toEqual([]);
    expect(findTimelineMatches([msg("1", "user", "hello")], "   ")).toEqual([]);
  });

  it("matches message text case-insensitively, one entry per occurrence", () => {
    const messages = [msg("1", "user", "Fix the BUG"), msg("2", "assistant", "bug one, Bug two")];
    expect(findTimelineMatches(messages, "bug")).toEqual([
      { messageId: "1", messageIndex: 0, start: 8, end: 11 },
      { messageId: "2", messageIndex: 1, start: 0, end: 3 },
      { messageId: "2", messageIndex: 1, start: 9, end: 12 },
    ]);
  });

  it("searches what a reply said while working and the steps it took", () => {
    const reply = msg("2", "assistant", "done", {
      progress: [
        { type: "note", text: "planning the refactor" },
        { type: "tool", id: "t", name: "read_file", state: "completed", path: "src/store.ts" },
      ],
    });
    expect(messageSearchText(reply)).toBe("done\nplanning the refactor\nsrc/store.ts");
    expect(findTimelineMatches([reply], "refactor")).toHaveLength(1);
  });

  it("does not overlap occurrences", () => {
    expect(findTimelineMatches([msg("1", "user", "aaaa")], "aa")).toHaveLength(2);
  });

  it("honours case sensitivity, whole words and regexps", () => {
    const messages = [msg("1", "assistant", "Bug bug cat concatenate 123")];
    expect(findTimelineMatches(messages, "bug", { caseSensitive: true })).toHaveLength(1);
    expect(findTimelineMatches(messages, "cat", { wholeWord: true })).toHaveLength(1);
    expect(findTimelineMatches(messages, "\\d+", { regexp: true })).toHaveLength(1);
    expect(findTimelineMatches(messages, "(", { regexp: true })).toEqual([]);
  });
});

describe("chat search highlights", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubHighlightApi() {
    class FakeHighlight {
      priority = 0;
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    }
    const highlights = new Map<string, FakeHighlight>();
    vi.stubGlobal("CSS", { highlights });
    vi.stubGlobal("Highlight", FakeHighlight);
    return highlights;
  }

  function makeRoot(html: string) {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
  }

  it("marks only the active occurrence in the current message", () => {
    const highlights = stubHighlightApi();
    const root = makeRoot(
      '<div data-message-id="m0"><p>one one one</p></div><div data-message-id="m1"><p>one two</p></div>',
    );
    const active = paintSearchHighlights(root, "one", "m0", undefined, 1);
    expect(active?.toString()).toBe("one");
    expect(highlights.get("misty-chat-search-current")?.ranges[0]).toBe(active);
    // The other two occurrences in row 0 and the one in row 1 stay in the plain group.
    expect(highlights.get("misty-chat-search")?.ranges).toHaveLength(3);
    root.remove();
  });

  it("does not guess the active word when the message's DOM and data counts differ", () => {
    const highlights = stubHighlightApi();
    // Raw markdown holds three "foo" (one inside the link URL); the rendered
    // message shows two. Picking by index would paint the wrong word.
    const total = findTimelineMatches(
      [msg("m0", "assistant", "See [docs](https://x.dev/foo). Then foo, and foo.")],
      "foo",
    ).length;
    expect(total).toBe(3);
    const root = makeRoot(
      '<div data-message-id="m0"><p>See <a>docs</a>. Then foo, and foo.</p></div>',
    );

    const active = paintSearchHighlights(root, "foo", "m0", undefined, 2, total);

    expect(active).toBeNull();
    // The whole message is marked current instead.
    expect(highlights.get("misty-chat-search-current")?.ranges).toHaveLength(2);
    expect(highlights.has("misty-chat-search")).toBe(false);
    root.remove();
  });

  it("picks the active word when the message's DOM and data counts agree", () => {
    stubHighlightApi();
    const root = makeRoot('<div data-message-id="m0"><p>one <b>one</b> one</p></div>');
    const active = paintSearchHighlights(root, "one", "m0", undefined, 1, 3);
    expect(active?.startContainer.parentElement?.tagName).toBe("B");
    root.remove();
  });

  it("falls back to the first mounted occurrence when the active page is not rendered", () => {
    stubHighlightApi();
    const root = makeRoot('<div data-message-id="m0"><p>one two</p></div>');
    const active = paintSearchHighlights(root, "one", "m0", undefined, 5);
    expect(active?.toString()).toBe("one");
    root.remove();
  });
});

describe("scrollMatchIntoView", () => {
  function box(top: number, bottom: number): DOMRect {
    return {
      top,
      bottom,
      left: 0,
      right: 100,
      width: 100,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  }

  function fakeRange(rect: DOMRect): Range {
    const range = document.createRange();
    range.getBoundingClientRect = () => rect;
    return range;
  }

  it("scrolls a match below the view just into view with margin", () => {
    const scrollEl = document.createElement("div");
    scrollEl.getBoundingClientRect = () => box(100, 300);
    scrollMatchIntoView(scrollEl, fakeRange(box(400, 420)));
    expect(scrollEl.scrollTop).toBe(144); // 420 - 300 + 24
  });

  it("scrolls a match above the view back with margin", () => {
    const scrollEl = document.createElement("div");
    scrollEl.getBoundingClientRect = () => box(100, 300);
    scrollEl.scrollTop = 200;
    scrollMatchIntoView(scrollEl, fakeRange(box(90, 110)));
    expect(scrollEl.scrollTop).toBe(166); // 200 + (90 - 100 - 24)
  });

  it("leaves an already-visible match alone", () => {
    const scrollEl = document.createElement("div");
    scrollEl.getBoundingClientRect = () => box(100, 300);
    scrollEl.scrollTop = 50;
    scrollMatchIntoView(scrollEl, fakeRange(box(150, 170)));
    expect(scrollEl.scrollTop).toBe(50);
  });

  it("is inert without a container or range", () => {
    const scrollEl = document.createElement("div");
    scrollEl.getBoundingClientRect = () => box(100, 300);
    expect(() => scrollMatchIntoView(null, fakeRange(box(400, 420)))).not.toThrow();
    expect(() => scrollMatchIntoView(scrollEl, null)).not.toThrow();
  });
});
