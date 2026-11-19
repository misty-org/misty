import { useCallback, useEffect, useState } from "react";
import { useMistyStore } from "../conversations/state/useMistyStore";
import { useChatFolders } from "../shared-folders/chatFolder";
import { updateCodePageLayout, useCodePageLayout } from "./codePageStore";

/** Opens a project in the Code page, remembered for this device. */
export const openProject = (path: string) => updateCodePageLayout({ lastProject: path });

export const closeChat = () => updateCodePageLayout({ chat: "" });

/**
 * The chat open in the Code page's column, while it is still one of the person's chats. One
 * deleted since is forgotten once the chats are read; `pending` says they are still being read.
 */
export function useCodeChat() {
  const chat = useCodePageLayout((state) => state.value.chat);
  const exists = useMistyStore((state) =>
    chat ? state.conversations.some((item) => item.id === chat) : false,
  );
  const loading = useMistyStore((state) => state.conversationsLoading);
  // Chats that couldn't be read stop the wait: the page opens without the chat, and the
  // sidebar says the chats couldn't load (the reads keep retrying behind it).
  const failed = useMistyStore((state) => Boolean(state.conversationsError));
  const read = useMistyStore((state) => state.conversations.length > 0);
  const gone = Boolean(chat) && !exists && read && !loading;
  useEffect(() => {
    if (gone) closeChat();
  }, [gone]);
  return { chat: exists ? chat : "", pending: Boolean(chat) && !exists && loading && !failed };
}

/**
 * The project folder the Code page works in while no chat is open in it: the last one picked
 * here, else the person's most recently used project, while it is still one of theirs. `failed`
 * says the projects couldn't be read; `retry` reads them again.
 */
export function useCodeProject() {
  const lastProject = useCodePageLayout((state) => state.value.lastProject);
  const projects = useChatFolders((state) => state.projects);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(false);
    void useChatFolders
      .getState()
      .loadProjects()
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [round]);
  const retry = useCallback(() => setRound((value) => value + 1), []);
  const folder = projects?.some((project) => project.path === lastProject)
    ? lastProject
    : (projects?.[0]?.path ?? "");
  return { folder, loaded: projects !== null, failed: failed && projects === null, retry };
}
