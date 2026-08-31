import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiProactiveNudge } from "./AiRecap";
import { useAiSurfaceStore } from "./store";
import type { AiSurfaceAdapter } from "./types";

const adapter: AiSurfaceAdapter = {
  surfaceId: "inbox",
  label: "Inbox",
  getContext: () => [],
  getSuggestedActions: () => [
    { id: "summary", label: "Summarize thread", prompt: "Summarize this email thread." },
  ],
};

describe("AiProactiveNudge", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    useAiSurfaceStore.setState({
      sessions: {},
      registrations: {},
      companion: { phase: "home", completedCount: 0 },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("prefills a review without opening or running work on its own", () => {
    const onOpen = vi.fn();
    act(() =>
      root.render(
        <AiProactiveNudge
          accountId="account-a"
          paneId="pane-a"
          adapter={adapter}
          reason="Because you enabled suggestions for Inbox. Nothing starts until you review it."
          onDismiss={() => undefined}
          onSnooze={() => undefined}
          onOpen={onOpen}
        />,
      ),
    );

    expect(container.textContent).toContain("Nothing starts until you review it.");
    const review = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Review"),
    );
    act(() => review?.click());

    expect(onOpen).toHaveBeenCalledOnce();
    expect(useAiSurfaceStore.getState().sessions["account-a:pane-a"]).toMatchObject({
      prompt: "Summarize this email thread.",
      state: "idle",
      messages: [],
    });
  });
});
