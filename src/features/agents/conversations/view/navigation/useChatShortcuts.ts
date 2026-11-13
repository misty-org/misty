import type { RefObject } from "react";
import { useShortcutHandler } from "@/features/shortcuts";
import { useMistyStore } from "../../state/useMistyStore";

/** The chat's own shortcuts that act on the message box and the run (shared/shortcuts/chatCommands). */
export function useChatShortcuts(
  scrollRef: RefObject<HTMLElement | null>,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  working: boolean,
) {
  const shown = () =>
    Boolean(scrollRef.current?.isConnected && scrollRef.current.getClientRects().length);
  useShortcutHandler(
    "chat.focus_composer",
    () => {
      textareaRef.current?.focus();
    },
    shown,
  );
  useShortcutHandler(
    "chat.stop_run",
    () => {
      void useMistyStore
        .getState()
        .cancelResponse?.()
        ?.catch(() => undefined);
    },
    () => working && shown(),
  );
}
