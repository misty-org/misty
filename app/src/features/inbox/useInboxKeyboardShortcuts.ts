import { useEffect } from "react";
import type { InboxThread, ReplyMode } from "./model";

export function useInboxKeyboardShortcuts(params: {
  threads: InboxThread[];
  selectedThread: InboxThread | null;
  selectedThreadKey: string;
  isComposerOpen: boolean;
  messageVisible: boolean;
  onOpenThread: (thread: InboxThread) => void;
  onCloseThread: () => void;
  onOpenCompose: (mode?: ReplyMode) => void;
  onAction: (
    thread: InboxThread,
    action: { read?: boolean; archived?: boolean; starred?: boolean },
  ) => void;
  onFocusSearch: () => void;
}) {
  const {
    threads,
    selectedThread,
    selectedThreadKey,
    isComposerOpen,
    messageVisible,
    onOpenThread,
    onCloseThread,
    onOpenCompose,
    onAction,
    onFocusSearch,
  } = params;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore shortcuts if inside input, textarea, or contentEditable
      const target = event.target as HTMLElement | null;
      if (
        isComposerOpen ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }

      const activeThread =
        selectedThread || threads.find((t) => t.key === selectedThreadKey) || threads[0];

      const currentIndex = threads.findIndex((t) => t.key === activeThread?.key);

      switch (event.key) {
        // Navigation: Next thread
        case "j":
        case "ArrowDown": {
          if (threads.length > 0) {
            event.preventDefault();
            const nextIndex = currentIndex < threads.length - 1 ? currentIndex + 1 : 0;
            onOpenThread(threads[nextIndex]);
          }
          break;
        }

        // Navigation: Previous thread
        case "k":
        case "ArrowUp": {
          if (threads.length > 0) {
            event.preventDefault();
            const prevIndex = currentIndex > 0 ? currentIndex - 1 : threads.length - 1;
            onOpenThread(threads[prevIndex]);
          }
          break;
        }

        // Open thread
        case "Enter":
        case "o": {
          if (activeThread && !messageVisible) {
            event.preventDefault();
            onOpenThread(activeThread);
          }
          break;
        }

        // Close thread / Escape
        case "Escape": {
          if (messageVisible) {
            event.preventDefault();
            onCloseThread();
          }
          break;
        }

        // Archive thread
        case "e":
        case "y": {
          if (activeThread) {
            event.preventDefault();
            onAction(activeThread, { archived: true });
          }
          break;
        }

        // Star / Unstar
        case "s": {
          if (activeThread) {
            event.preventDefault();
            onAction(activeThread, { starred: !activeThread.starred });
          }
          break;
        }

        // Mark unread / read
        case "u": {
          if (activeThread) {
            event.preventDefault();
            onAction(activeThread, { read: activeThread.unread });
          }
          break;
        }

        // Reply
        case "r": {
          if (activeThread && messageVisible) {
            event.preventDefault();
            onOpenCompose("reply");
          }
          break;
        }

        // Reply all
        case "a": {
          if (activeThread && messageVisible) {
            event.preventDefault();
            onOpenCompose("replyAll");
          }
          break;
        }

        // Forward
        case "f": {
          if (activeThread && messageVisible) {
            event.preventDefault();
            onOpenCompose("forward");
          }
          break;
        }

        // Compose new email
        case "c": {
          event.preventDefault();
          onOpenCompose();
          break;
        }

        // Focus search
        case "/": {
          event.preventDefault();
          onFocusSearch();
          break;
        }

        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    threads,
    selectedThread,
    selectedThreadKey,
    isComposerOpen,
    messageVisible,
    onOpenThread,
    onCloseThread,
    onOpenCompose,
    onAction,
    onFocusSearch,
  ]);
}
