import { useSpaceChatPermissions } from "@/features/spaces/chat";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canManageSpaceLifecycle, canOpenMistySpaceSection } from "./mistySpace";
import { resetSpacesAccountState, useSpacesStore } from "./store/useSpacesStore";

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

  it("reserves lifecycle management for operators", () => {
    const space = mistySpace();
    expect(canManageSpaceLifecycle(space, "rename")).toBe(false);
    expect(canManageSpaceLifecycle(space, "invite")).toBe(false);
    expect(canManageSpaceLifecycle(space, "delete")).toBe(false);
  });

  it("opens canonical work surfaces only when the server grants them", () => {
    const memberSpace = mistySpace();
    expect(canOpenMistySpaceSection(memberSpace, "chat")).toBe(true);
    expect(canOpenMistySpaceSection(memberSpace, "notes")).toBe(false);
    expect(canOpenMistySpaceSection(memberSpace, "planner")).toBe(false);
    expect(canOpenMistySpaceSection(memberSpace, "library")).toBe(false);

    const operatorSpace = mistySpace();
    operatorSpace.permissions = {
      ...operatorSpace.permissions,
      "space.invite": true,
      "tasks.view": true,
      "library.view": true,
    };
    expect(canOpenMistySpaceSection(operatorSpace, "notes")).toBe(true);
    expect(canOpenMistySpaceSection(operatorSpace, "drawings")).toBe(true);
    expect(canOpenMistySpaceSection(operatorSpace, "planner")).toBe(true);
    expect(canOpenMistySpaceSection(operatorSpace, "library")).toBe(true);
    expect(canOpenMistySpaceSection(operatorSpace, "settings")).toBe(true);
  });

  it("keeps private support chat writable without exposing the shared library", async () => {
    await renderProbe("conversation-1", "misty_support");
    expect(readProbe()).toMatchObject({
      canWriteMessages: true,
      canUploadAttachments: true,
      canBrowseLibrary: false,
    });

    await renderProbe("", undefined);
    expect(readProbe().canWriteMessages).toBe(true);

    useSpacesStore.setState({ referenceOnly: true });
    await renderProbe("conversation-1", "misty_support");
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
    owner_user_id: "owner",
    name: "Misty",
    role: "member",
    member_count: 0,
    pending_count: 0,
    is_shared: false,
    permissions: {
      "messages.read": true,
      "messages.write": true,
      "attachments.upload": true,
      "library.view": false,
      "space.rename": false,
      "space.invite": false,
      "space.delete": false,
    },
    created_at: "2026-08-03T00:00:00Z",
    updated_at: "2026-08-03T00:00:00Z",
  };
}
