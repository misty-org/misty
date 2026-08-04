import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canManageSpaceLifecycle, isMistySpace } from "@/features/spaces/mistySpace";
import { useSpaceChatPermissions } from "@/features/spaces/spaceChat/useSpaceChatPermissions";
import type { Space } from "@/models/interfaces/features/spaces/types";
import { resetSpacesAccountState, useSpacesStore } from "@/stores/spaces/useSpacesStore";

describe("permanent Misty Space", () => {
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

  it("is system-managed and cannot expose lifecycle actions", () => {
    const space = mistySpace();
    expect(isMistySpace(space)).toBe(true);
    expect(canManageSpaceLifecycle(space, "rename")).toBe(false);
    expect(canManageSpaceLifecycle(space, "invite")).toBe(false);
    expect(canManageSpaceLifecycle(space, "leave")).toBe(false);
    expect(canManageSpaceLifecycle(space, "delete")).toBe(false);
  });

  it("allows text only in the user's support conversation while connected", async () => {
    await renderProbe("support-1", "misty_support");
    expect(readProbe()).toMatchObject({
      canWriteMessages: true,
      canUploadAttachments: false,
      canBrowseLibrary: false,
    });

    await renderProbe("", undefined);
    expect(readProbe().canWriteMessages).toBe(false);

    useSpacesStore.setState({ referenceOnly: true });
    await renderProbe("support-1", "misty_support");
    expect(readProbe().canWriteMessages).toBe(false);
  });

  async function renderProbe(
    conversationId: string,
    conversationKind: "misty_support" | undefined,
  ) {
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
  conversationKind: "misty_support" | undefined;
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
    kind: "misty",
    support_conversation_id: "support-1",
    owner_user_id: "misty-publisher",
    name: "Misty",
    role: "member",
    member_count: 0,
    pending_count: 0,
    is_shared: true,
    permissions: {
      "messages.read": true,
      "messages.write": false,
      "misty.support.write": true,
      "attachments.upload": false,
      "library.view": false,
    },
    created_at: "2026-08-03T00:00:00Z",
    updated_at: "2026-08-03T00:00:00Z",
  };
}
