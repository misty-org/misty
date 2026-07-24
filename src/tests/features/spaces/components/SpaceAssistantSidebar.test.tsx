import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SpaceSectionNavigation } from "@/features/spaces/components/SpaceSectionNavigation";
import { SpaceAssistantSessionSidebar } from "@/features/spaces/mika/SpaceAssistantSessionSidebar";
import type { Space } from "@/models/interfaces/features/spaces/types";
import {
  resetMikaAccountState,
  spaceMikaScopeKey,
  useMikaSessionStore,
} from "@/stores/assistant/useMikaSessionStore";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";

describe("Space Assistant sessions in the Space sidebar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    resetMikaAccountState();
    useMikaSessionStore.setState({
      conversationScopeKey: spaceMikaScopeKey("account-1", "space-1"),
      conversations: [
        {
          id: "session-1",
          title: "Launch plan",
          updatedAt: Date.now(),
          createdAt: Date.now(),
        },
      ],
      activeConversationId: "session-1",
    });
    useSpacesStore.setState({
      spaces: [spaceFixture()],
      snapshotReady: true,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    resetMikaAccountState();
    useSpacesStore.setState({ spaces: [], snapshotReady: false });
    container.remove();
  });

  it("places New chat and the session list below the existing Space section strip", async () => {
    await renderPanel(root);

    const sectionStrip = container.querySelector('nav[aria-label="Space sections"]');
    const sessions = container.querySelector<HTMLElement>('[aria-label="Agent sessions"]');

    expect(sectionStrip).not.toBeNull();
    expect(sessions?.tagName).toBe("SECTION");
    expect(sessions?.textContent).toContain("New chat");
    expect(sessions?.textContent).toContain("Sessions");
    expect(sessions?.textContent).toContain("Launch plan");
    const relativePosition =
      sectionStrip && sessions ? sectionStrip.compareDocumentPosition(sessions) : 0;
    expect(Boolean(relativePosition & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(sessions?.className).not.toContain("border-r");
  });

  it("withholds the prior Space's sessions while the requested scope activates", async () => {
    useMikaSessionStore.setState({
      conversationScopeKey: spaceMikaScopeKey("account-1", "space-old"),
      conversations: [
        {
          id: "old-session",
          title: "Old Space secret",
          updatedAt: Date.now(),
          createdAt: Date.now(),
        },
      ],
      activeConversationId: "old-session",
    });

    await renderPanel(root);

    const sessions = container.querySelector<HTMLElement>('[aria-label="Agent sessions"]');
    expect(sessions?.getAttribute("aria-busy")).toBe("true");
    expect(sessions?.textContent).not.toContain("Old Space secret");
  });

  it("withholds matching cached sessions until Space access is freshly confirmed", async () => {
    useMikaSessionStore.setState({
      conversations: [
        {
          id: "cached-session",
          title: "Cached Space secret",
          updatedAt: Date.now(),
          createdAt: Date.now(),
        },
      ],
      activeConversationId: "cached-session",
    });

    await renderPanel(root, false);

    const sessions = container.querySelector<HTMLElement>('[aria-label="Agent sessions"]');
    expect(sessions?.getAttribute("aria-busy")).toBe("true");
    expect(sessions?.textContent).not.toContain("Cached Space secret");
  });
});

async function renderPanel(root: Root, accessReady = true) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/spaces/space-1/assistant"]}>
        <SpaceSectionNavigation
          spaceId="space-1"
          section="assistant"
          context={
            <SpaceAssistantSessionSidebar
              accountId="account-1"
              spaceId="space-1"
              accessReady={accessReady}
            />
          }
        />
      </MemoryRouter>,
    );
    await Promise.resolve();
  });
}

function spaceFixture(): Space {
  return {
    id: "space-1",
    owner_user_id: "account-1",
    name: "Design team",
    role: "owner",
    member_count: 1,
    pending_count: 0,
    is_personal: false,
    is_shared: true,
    created_at: "2026-07-19T00:00:00Z",
    updated_at: "2026-07-19T00:00:00Z",
  };
}
