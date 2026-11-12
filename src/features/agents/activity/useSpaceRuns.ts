import { useEffect, useMemo, useState } from "react";
import { conversationInSpace } from "../conversations/state/conversationSpace";
import type { GlobalAiConversation } from "../conversations/state/conversationTypes";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { useTutorChatIds } from "../tutor/tutorStore";
import { activityApi, type RunRow } from "./activityApi";
import { useRunEvents } from "./useRunSteps";

/** The chats of the window's Space that hold the person's own work: Tutor's live in Tutor. */
export function useSpaceChats(): GlobalAiConversation[] {
  const conversations = useMistyStore((state) => state.conversations);
  const tutorChats = useTutorChatIds();
  return useMemo(
    () =>
      conversations.filter(
        (conversation) => conversationInSpace(conversation) && !tutorChats.has(conversation.id),
      ),
    [conversations, tutorChats],
  );
}

/**
 * The runs in the window's Space on this computer, newest first, read again as runs report.
 * Null until first read.
 */
export function useSpaceRuns(limit = 200): {
  runs: RunRow[] | null;
  chats: GlobalAiConversation[];
  reload(): void;
} {
  const chats = useSpaceChats();
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [round, setRound] = useState(0);
  const reload = useMemo(() => () => setRound((value) => value + 1), []);
  const ids = useMemo(() => chats.map((chat) => chat.id).join("\n"), [chats]);
  useEffect(() => {
    let live = true;
    const chatIds = ids ? ids.split("\n") : [];
    void activityApi
      .timeline(chatIds, limit)
      .then((rows) => live && setRuns(rows))
      .catch(() => live && setRuns((known) => known ?? []));
    return () => {
      live = false;
    };
  }, [ids, limit, round]);
  useRunEvents(null, reload);
  return { runs, chats, reload };
}
