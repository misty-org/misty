import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMessageEditing } from "../chat/hooks/useMessageEditing";
import { useSpaceChatDraft } from "../chat/hooks/useSpaceChatDraft";

describe("SpaceChat reset effect", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("does not rerun data loading when reset state causes a render", async () => {
    const loadChatAgents = vi.fn();

    await act(async () => {
      root.render(<ResetEffectProbe loadChatAgents={loadChatAgents} />);
    });

    expect(loadChatAgents).toHaveBeenCalledTimes(1);

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });

    expect(loadChatAgents).toHaveBeenCalledTimes(1);
  });
});

function ResetEffectProbe(props: { loadChatAgents: () => void }) {
  const { loadChatAgents } = props;
  const { reset: resetDraft } = useSpaceChatDraft("space-1");
  const { reset: resetEditing } = useMessageEditing();
  const [renderCount, setRenderCount] = useState(0);

  useEffect(() => {
    resetDraft();
    resetEditing();
    loadChatAgents();
  }, [loadChatAgents, resetDraft, resetEditing]);

  return (
    <button type="button" onClick={() => setRenderCount((current) => current + 1)}>
      Render {renderCount}
    </button>
  );
}
