import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SpaceAssistant } from "@/features/spaces/SpaceAssistant";
import { useSettingsStore } from "@/stores/app";
import {
  resetMikaAccountState,
  spaceMikaScopeKey,
  useMikaSessionStore,
} from "@/stores/assistant/useMikaSessionStore";

describe("SpaceAssistant", () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalRefreshStatus = useMikaSessionStore.getState().refreshStatus;
  const originalActivateConversationScope =
    useMikaSessionStore.getState().activateConversationScope;

  beforeEach(async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    resetMikaAccountState();
    await useMikaSessionStore
      .getState()
      .activateConversationScope(spaceMikaScopeKey("account-1", "space-1"));
    useMikaSessionStore.setState({
      refreshStatus: vi.fn(async () => {}),
      status: {
        configured: true,
        spaceScopedSessions: true,
        model: "mika-low",
        modelName: "Mika Low",
        running: false,
        sessionId: null,
        error: null,
      },
    });
    useSettingsStore.setState({
      loaded: true,
      settings: { path: "", document: { assistant: { enabled: true } } },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useMikaSessionStore.setState({
      refreshStatus: originalRefreshStatus,
      activateConversationScope: originalActivateConversationScope,
    });
    resetMikaAccountState();
    container.remove();
  });

  it("renders the original full-page Assistant layout inside a Space", async () => {
    await renderAssistant(root);

    expect(container.querySelector('[aria-label="Mika sessions"]')).toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("Assistant");
    expect(container.textContent).toContain("Private · Design team");
    expect(container.textContent).toContain("Ask Mika about Design team");
    expect(container.textContent).toContain("Space context only");

    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Ask Mika about Design team"]',
    );
    expect(composer?.disabled).toBe(false);
    expect(composer?.placeholder).toBe("Ask Mika about Design team…");
    expect(container.querySelector('button[aria-label="Add context"]')).toBeNull();
  });

  it("keeps the composer disabled when the server cannot isolate Space sessions", async () => {
    useMikaSessionStore.setState((state) => ({
      status: state.status ? { ...state.status, spaceScopedSessions: false } : state.status,
    }));

    await renderAssistant(root);

    expect(container.textContent).toContain("Private Space Assistant is unavailable");
    expect(container.textContent).toContain("permission-checked Space sessions");
    const composer = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Ask Mika about Design team"]',
    );
    expect(composer?.disabled).toBe(true);
    expect(composer?.placeholder).toBe("Private Space sessions are unavailable");
  });

  it("does not paint the prior Space while a new scope is still activating", async () => {
    useMikaSessionStore.setState({
      conversationScopeKey: spaceMikaScopeKey("account-1", "space-old"),
      conversations: [{ id: "old-session", title: "Old Space strategy", updatedAt: Date.now() }],
      activeConversationId: "old-session",
      messages: [{ id: "old-message", role: "assistant", text: "Old Space secret" }],
      status: {
        configured: true,
        spaceScopedSessions: true,
        model: "mika-low",
        modelName: "Old Space model",
        running: true,
        sessionId: "old-session",
        error: "Old Space error",
      },
      activateConversationScope: vi.fn(() => new Promise<void>(() => {})),
    });

    await renderAssistant(root);

    expect(container.textContent).toContain("Switching Space context…");
    expect(container.textContent).not.toContain("Old Space strategy");
    expect(container.textContent).not.toContain("Old Space secret");
    expect(container.textContent).not.toContain("Old Space error");
    expect(container.textContent).not.toContain("Old Space model");
    expect(container.textContent).not.toContain("Running");
  });
});

async function renderAssistant(root: Root) {
  await act(async () => {
    root.render(
      <SpaceAssistant
        accountId="account-1"
        spaceId="space-1"
        spaceName="Design team"
        permissions={{
          "messages.read": true,
          "tasks.view": true,
          "library.view": true,
        }}
      />,
    );
    await Promise.resolve();
  });
}
