import type { SpaceMember } from "@/api/spaces/dto/interfaces/types";
import { useSpaceChatDraft } from "@/features/chat-composer/useSpaceChatDraft";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSuggestions } from "../hooks/useChatSuggestions";
import { useComposerInput } from "../hooks/useComposerInput";
import { SpaceChatComposer } from "./SpaceChatComposer";

const member: SpaceMember = {
  space_id: "space-1",
  user_id: "user-sam",
  name: "Sam Lee",
  email: "sam@example.com",
  role: "member",
  joined_at: "2026-08-29T00:00:00Z",
  read_message_seq: 0,
};

describe("SpaceChatComposer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Element.prototype.scrollIntoView = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("opens the mention popup from the toolbar without destabilizing the composer", async () => {
    await act(async () => root.render(<ComposerHarness />));

    const mentionButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Mention someone"]',
    );
    await act(async () => {
      mentionButton?.click();
      await Promise.resolve();
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('[role="combobox"]');
    expect(textarea?.value).toBe("@");
    expect(textarea?.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.textContent).toContain("Sam Lee");
  });
});

function ComposerHarness() {
  const draft = useSpaceChatDraft("space-1");
  const suggestions = useChatSuggestions({
    spaceId: "space-1",
    members: [member],
    agents: [],
    currentUserId: "current-user",
    canBrowseLibrary: false,
    canReadLibrary: false,
    selectedLibraryIds: draft.selectedLibraryIds,
    attachmentSlotsLeft: draft.attachmentSlotsLeft,
  });
  const input = useComposerInput({
    draft,
    suggestions,
    canWriteMessages: true,
    canUploadAttachments: true,
    canBrowseLibrary: false,
    openPicker: vi.fn(),
  });

  return (
    <SpaceChatComposer
      draft={draft}
      suggestions={suggestions}
      input={input}
      isConversation
      canUploadAttachments
      canBrowseLibrary={false}
      replyToSenderName="message"
      mentionNames={[member.name]}
      onSubmit={(event) => event.preventDefault()}
      onOpenPicker={vi.fn()}
    />
  );
}
