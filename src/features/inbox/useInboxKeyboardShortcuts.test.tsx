import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxThread } from "./model";
import { useInboxKeyboardShortcuts } from "./useInboxKeyboardShortcuts";

function ShortcutHarness(props: {
  threads: InboxThread[];
  selectedThread: InboxThread | null;
  selectedThreadKey: string;
  isComposerOpen: boolean;
  messageVisible: boolean;
  onOpenThread: (thread: InboxThread) => void;
  onCloseThread: () => void;
  onOpenCompose: (mode?: any) => void;
  onAction: (thread: InboxThread, action: any) => void;
  onFocusSearch: () => void;
  enabled?: () => boolean;
}) {
  useInboxKeyboardShortcuts(props);
  return <div>Shortcut test harness</div>;
}

describe("useInboxKeyboardShortcuts", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const thread1: InboxThread = {
    provider: "gmail",
    provider_id: "t1",
    account_id: "a1",
    connectionId: "c1",
    key: "c1:t1",
    subject: "Email 1",
    snippet: "First",
    participants: [{ email: "a@test.com" }],
    labels: ["INBOX"],
    last_message_at: "2026-08-20T10:00:00Z",
    unread: true,
    starred: false,
    messages: [],
  };

  const thread2: InboxThread = {
    provider: "gmail",
    provider_id: "t2",
    account_id: "a1",
    connectionId: "c1",
    key: "c1:t2",
    subject: "Email 2",
    snippet: "Second",
    participants: [{ email: "b@test.com" }],
    labels: ["INBOX"],
    last_message_at: "2026-08-19T10:00:00Z",
    unread: false,
    starred: true,
    messages: [],
  };

  it("navigates threads using j and k keys", async () => {
    const onOpenThread = vi.fn();

    await act(async () => {
      root.render(
        <ShortcutHarness
          threads={[thread1, thread2]}
          selectedThread={thread1}
          selectedThreadKey={thread1.key}
          isComposerOpen={false}
          messageVisible={false}
          onOpenThread={onOpenThread}
          onCloseThread={vi.fn()}
          onOpenCompose={vi.fn()}
          onAction={vi.fn()}
          onFocusSearch={vi.fn()}
        />,
      );
    });

    // Press j to go to next thread
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    expect(onOpenThread).toHaveBeenCalledWith(thread2);

    // Press k to go back
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
    expect(onOpenThread).toHaveBeenCalledWith(thread2);
  });

  it("ignores every shortcut when its Inbox pane is not focused", async () => {
    const onOpenThread = vi.fn();
    const onOpenCompose = vi.fn();
    const onFocusSearch = vi.fn();

    await act(async () => {
      root.render(
        <ShortcutHarness
          threads={[thread1, thread2]}
          selectedThread={thread1}
          selectedThreadKey={thread1.key}
          isComposerOpen={false}
          messageVisible={false}
          onOpenThread={onOpenThread}
          onCloseThread={vi.fn()}
          onOpenCompose={onOpenCompose}
          onAction={vi.fn()}
          onFocusSearch={onFocusSearch}
          enabled={() => false}
        />,
      );
    });

    for (const key of ["j", "c", "/"]) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key }));
    }
    expect(onOpenThread).not.toHaveBeenCalled();
    expect(onOpenCompose).not.toHaveBeenCalled();
    expect(onFocusSearch).not.toHaveBeenCalled();
  });

  it("triggers archive, star, mark read, and compose shortcuts", async () => {
    const onAction = vi.fn();
    const onOpenCompose = vi.fn();
    const onFocusSearch = vi.fn();

    await act(async () => {
      root.render(
        <ShortcutHarness
          threads={[thread1]}
          selectedThread={thread1}
          selectedThreadKey={thread1.key}
          isComposerOpen={false}
          messageVisible={true}
          onOpenThread={vi.fn()}
          onCloseThread={vi.fn()}
          onOpenCompose={onOpenCompose}
          onAction={onAction}
          onFocusSearch={onFocusSearch}
        />,
      );
    });

    // Press e to archive
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "e" }));
    expect(onAction).toHaveBeenCalledWith(thread1, { archived: true });

    // Press s to star
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    expect(onAction).toHaveBeenCalledWith(thread1, { starred: true });

    // Press u to toggle read/unread
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "u" }));
    expect(onAction).toHaveBeenCalledWith(thread1, { read: true });

    // Press r to reply
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));
    expect(onOpenCompose).toHaveBeenCalledWith("reply");

    // Press a to reply all
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(onOpenCompose).toHaveBeenCalledWith("replyAll");

    // Press f to forward
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
    expect(onOpenCompose).toHaveBeenCalledWith("forward");

    // Press c to compose
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
    expect(onOpenCompose).toHaveBeenCalledWith();

    // Press / to focus search
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "/" }));
    expect(onFocusSearch).toHaveBeenCalled();
  });
});
