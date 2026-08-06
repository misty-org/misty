import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canManageSpaceLifecycle } from "@/features/spaces/mistySpace";
import { useSpaceChatPermissions } from "@/features/spaces/spaceChat/useSpaceChatPermissions";
import type { Space } from "@/models/interfaces/features/spaces/types";
import { resetSpacesAccountState, useSpacesStore } from "@/stores/spaces/useSpacesStore";

describe("default Misty Space", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    resetSpacesAccountState();
    useSpacesStore.setState({ spaces: [mistySpace()], referenceOnly: false });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    resetSpacesAccountState();
    container.remove();
  });

  it("allows ordinary management but respects operator-only deletion", () => {
    const space = mistySpace();
    expect(canManageSpaceLifecycle(space, "rename")).toBe(true);
    expect(canManageSpaceLifecycle(space, "invite")).toBe(true);
    expect(canManageSpaceLifecycle(space, "delete")).toBe(false);
  });

  it("uses normal Space permissions in every conversation", async () => {
    await renderProbe("conversation-1", "standard");
    expect(readProbe()).toMatchObject({
      canWriteMessages: true,
      canUploadAttachments: true,
      canBrowseLibrary: true,
    });

    await renderProbe("", undefined);
    expect(readProbe().canWriteMessages).toBe(true);

    useSpacesStore.setState({ referenceOnly: true });
    await renderProbe("conversation-1", "standard");
    expect(readProbe().canWriteMessages).toBe(false);
  });

  async function renderProbe(conversationId: string, conversationKind: "standard" | undefined) {
    await act(async () => {
      root.render(
        <PermissionProbe conversationId={conversationId} conversationKind={conversationKind} />,
      );
    });
  }

  function readProbe() {
    return JSON.parse(container.textContent ?? "{}") as Record<string, boolean>;
  }
});

function PermissionProbe(props: {
  conversationId: string;
  conversationKind: "standard" | undefined;
}) {
  const permissions = useSpaceChatPermissions(
    "misty",
    props.conversationId,
    props.conversationKind,
  );
  return <output>{JSON.stringify(permissions)}</output>;
}

function mistySpace(): Space {
  return {
    id: "misty",
    kind: "standard",
    owner_user_id: "owner",
    name: "Misty",
    role: "owner",
    member_count: 0,
    pending_count: 0,
    is_shared: false,
    permissions: {
      "messages.read": true,
      "messages.write": true,
      "attachments.upload": true,
      "library.view": true,
      "space.delete": false,
    },
    created_at: "2026-08-03T00:00:00Z",
    updated_at: "2026-08-03T00:00:00Z",
  };
}
