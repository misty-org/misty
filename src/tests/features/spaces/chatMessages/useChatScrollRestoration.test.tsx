import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TestingClearChatScrollPositions,
  useChatScrollRestoration,
} from "@/features/spaces/spaceChat/useChatScrollRestoration";

const messages = [{}];

function Probe({
  conversationId,
  scrollHeight = 1_000,
  revision = messages,
}: {
  conversationId: string;
  scrollHeight?: number;
  revision?: readonly unknown[];
}) {
  const scroll = useChatScrollRestoration({
    viewerId: "user-1",
    spaceId: "space-1",
    conversationId,
    ready: true,
    messages: revision,
    pendingRunCount: 0,
  });
  return (
    <div
      data-testid="scroller"
      ref={(element) => {
        scroll.scrollRef.current = element;
        if (!element) return;
        Object.defineProperty(element, "clientHeight", { configurable: true, value: 200 });
        Object.defineProperty(element, "scrollHeight", {
          configurable: true,
          value: scrollHeight,
        });
      }}
      onScroll={scroll.onScroll}
    />
  );
}

describe("useChatScrollRestoration", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.sessionStorage.clear();
    TestingClearChatScrollPositions();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  const scroller = () => container.querySelector<HTMLElement>("[data-testid=scroller]")!;

  it("restores an independent position for every conversation", async () => {
    await act(async () => root.render(<Probe conversationId="conversation-a" />));
    expect(scroller().scrollTop).toBe(800);

    scroller().scrollTop = 320;
    await act(async () => scroller().dispatchEvent(new Event("scroll", { bubbles: true })));

    await act(async () => root.render(<Probe conversationId="conversation-b" />));
    expect(scroller().scrollTop).toBe(800);
    scroller().scrollTop = 510;
    await act(async () => scroller().dispatchEvent(new Event("scroll", { bubbles: true })));

    await act(async () => root.render(<Probe conversationId="conversation-a" />));
    expect(scroller().scrollTop).toBe(320);
  });

  it("follows new messages only when the conversation was already at the bottom", async () => {
    await act(async () => root.render(<Probe conversationId="conversation-a" />));
    expect(scroller().scrollTop).toBe(800);

    await act(async () =>
      root.render(
        <Probe conversationId="conversation-a" scrollHeight={1_200} revision={[{}, {}]} />,
      ),
    );
    expect(scroller().scrollTop).toBe(1_000);

    scroller().scrollTop = 250;
    await act(async () => scroller().dispatchEvent(new Event("scroll", { bubbles: true })));
    await act(async () =>
      root.render(
        <Probe conversationId="conversation-a" scrollHeight={1_400} revision={[{}, {}, {}]} />,
      ),
    );
    expect(scroller().scrollTop).toBe(250);
  });
});
