import { useCallback, useEffect, useMemo } from "react";
import { create } from "zustand";
import { useUserStore } from "@/features/account/core";
import { invoke } from "@/native/invoke";
import { agentAccountId, useAgentAccountId } from "../personal/agentAccount";

/**
 * Each chat's working folder on this computer. A chat owns it: a project the person picked, or
 * the chat's own scratch folder, which native code makes on its first run and deletes with the
 * chat (`engines/chat_folder.rs`). Agents own no folders. A new chat with no id yet keeps its
 * choice as a draft until it is created (`adoptDraft`).
 */
export type ChatFolderKind = "project" | "scratch";

export interface ChatFolder {
  path: string;
  kind: ChatFolderKind;
}

/** One of the person's project folders, as `project_folder_list` gives it. */
export interface ProjectFolder {
  path: string;
  lastUsedAt: number;
}

/** A chat that hasn't started has no id: "" or the draft key (`DRAFT_CHAT` in `draftChat.ts`). */
export const isDraftChat = (conversationId: string | null | undefined) =>
  !conversationId || conversationId === "draft";

interface ChatFoldersState {
  /** Each loaded chat's folder, by conversation id. */
  byConversation: Record<string, ChatFolder>;
  /** Chats whose folder couldn't be read. */
  failed: Record<string, boolean>;
  /** The project a new chat will work in once it exists; null keeps it in its scratch folder. */
  draft: string | null;
  /** The person's projects, most recently used first; null before the first read. */
  projects: ProjectFolder[] | null;
  /**
   * Every chat that works in a project, with the project's path: those are Code's, listed on the
   * Code page and never in the sidebar. Null before the first read.
   */
  projectChats: Record<string, string> | null;
  /** Reads the chats that work in a project again. */
  loadProjectChats(): Promise<Record<string, string>>;
  /** Reads a chat's folder. */
  load(conversationId: string): Promise<ChatFolder>;
  /** Reads the person's projects again. */
  loadProjects(): Promise<ProjectFolder[]>;
  /**
   * Picks a project in the system's dialog and makes it the chat's folder (the draft's, for a new
   * chat). The path, or null when the person cancelled.
   */
  choose(conversationId: string | undefined): Promise<string | null>;
  /** Picks a project in the system's dialog without giving it to a chat (the Code page's). */
  addProject(): Promise<string | null>;
  /** Makes one of the person's projects the chat's folder. */
  use(conversationId: string | undefined, path: string): Promise<void>;
  /** Puts the chat back in its own scratch folder. */
  scratch(conversationId: string | undefined): Promise<void>;
  /** Forgets a project; chats that worked there go back to their scratch folders. */
  forgetProject(path: string): Promise<void>;
  /** Gives a just-created chat the new chat's choice. */
  adoptDraft(conversationId: string): void;
  /**
   * Picks, in the system's dialog, where the next project goes instead of the projects folder.
   * The folder, or null when the person cancelled.
   */
  pickProjectParent(): Promise<string | null>;
  /**
   * "Open in Code": makes a project named `name` in `parent` (the projects folder, or the one just
   * picked), moves the chat's scratch files into it, and makes it the chat's folder. Its path.
   */
  openInCode(conversationId: string, parent: string, name: string): Promise<string>;
}

const account = () => agentAccountId();

/** Reads of a chat's folder still out, by conversation id. */
const reading = new Map<string, Promise<ChatFolder>>();

/** The read of the chats that work in a project still out, by account. */
const readingProjectChats = new Map<string, Promise<Record<string, string>>>();

export const useChatFolders = create<ChatFoldersState>((set, get) => {
  const keep = (conversationId: string, folder: ChatFolder) => {
    const projectChats = get().projectChats;
    set({
      byConversation: { ...get().byConversation, [conversationId]: folder },
      failed: { ...get().failed, [conversationId]: false },
      // A chat that moves into a project moves to Code at once.
      ...(projectChats && folder.kind === "project"
        ? { projectChats: { ...projectChats, [conversationId]: folder.path } }
        : {}),
    });
  };
  const refreshProjects = () =>
    void get()
      .loadProjects()
      .catch(() => undefined);
  return {
    byConversation: {},
    failed: {},
    draft: null,
    projects: null,
    projectChats: null,
    loadProjectChats() {
      // Every view asks at once when it opens; they share one read. An answer for an account
      // that has since changed is dropped, so it never lands on the new one's list.
      const asked = account();
      const running = readingProjectChats.get(asked);
      if (running) return running;
      const read = invoke<Record<string, string>>("chat_folder_projects", { account: asked })
        .then((projectChats) => {
          if (account() === asked) set({ projectChats });
          return projectChats;
        })
        .finally(() => readingProjectChats.delete(asked));
      readingProjectChats.set(asked, read);
      return read;
    },
    load(conversationId) {
      // Every view of a chat asks at once when it opens; they share one read.
      const asked = reading.get(conversationId);
      if (asked) return asked;
      const read = invoke<ChatFolder>("chat_folder", {
        account: account(),
        conversation: conversationId,
      })
        .then((folder) => {
          keep(conversationId, folder);
          return folder;
        })
        .catch((reason: unknown) => {
          set({ failed: { ...get().failed, [conversationId]: true } });
          throw reason;
        })
        .finally(() => reading.delete(conversationId));
      reading.set(conversationId, read);
      return read;
    },
    async loadProjects() {
      const projects = await invoke<ProjectFolder[]>("project_folder_list", {
        account: account(),
      });
      set({ projects });
      return projects;
    },
    async choose(conversationId) {
      if (isDraftChat(conversationId)) {
        const path = await get().addProject();
        if (path) set({ draft: path });
        return path;
      }
      const id = conversationId!;
      const path = await invoke<string | null>("chat_folder_choose", {
        account: account(),
        conversation: id,
      });
      if (path) {
        keep(id, { path, kind: "project" });
        refreshProjects();
      }
      return path ?? null;
    },
    async addProject() {
      const path = await invoke<string | null>("chat_folder_choose", { account: account() });
      if (path) refreshProjects();
      return path ?? null;
    },
    async use(conversationId, path) {
      if (isDraftChat(conversationId)) {
        set({ draft: path });
        return;
      }
      const id = conversationId!;
      const before = get().byConversation[id];
      // Shown at once; native code has the last word.
      keep(id, { path, kind: "project" });
      try {
        await invoke<void>("chat_folder_use", { account: account(), conversation: id, path });
      } catch (reason) {
        if (before) keep(id, before);
        throw reason;
      }
      refreshProjects();
    },
    async scratch(conversationId) {
      if (isDraftChat(conversationId)) {
        set({ draft: null });
        return;
      }
      const id = conversationId!;
      const path = await invoke<string>("chat_folder_scratch", {
        account: account(),
        conversation: id,
      });
      keep(id, { path, kind: "scratch" });
    },
    async forgetProject(path) {
      await invoke<void>("project_folder_forget", { account: account(), path });
      set({
        projects: get().projects?.filter((project) => project.path !== path) ?? null,
        draft: get().draft === path ? null : get().draft,
      });
      // The chats that worked there are back in scratch: native code says where.
      for (const [id, folder] of Object.entries(get().byConversation))
        if (folder.kind === "project" && folder.path === path)
          void get()
            .load(id)
            .catch(() => undefined);
    },
    async pickProjectParent() {
      const path = await invoke<string | null>("project_parent_pick", { account: account() });
      return path ?? null;
    },
    async openInCode(conversationId, parent, name) {
      const path = await invoke<string>("chat_open_in_code", {
        account: account(),
        conversation: conversationId,
        parent,
        name,
      });
      keep(conversationId, { path, kind: "project" });
      refreshProjects();
      return path;
    },
    adoptDraft(conversationId) {
      const { draft } = get();
      if (!draft || isDraftChat(conversationId)) return;
      set({ draft: null });
      // The first run names it too (`runBody.ts`), so it holds even before this lands.
      void get()
        .use(conversationId, draft)
        .catch(
          () =>
            void get()
              .load(conversationId)
              .catch(() => undefined),
        );
    },
  };
});

/** Signed out or switched account: no one else's folders show. */
let shownAccount = agentAccountId();
useUserStore.subscribe(() => {
  if (agentAccountId() === shownAccount) return;
  shownAccount = agentAccountId();
  useChatFolders.setState({
    byConversation: {},
    failed: {},
    draft: null,
    projects: null,
    projectChats: null,
  });
});

/**
 * The project a chat's next run should name, or "" for none (native code then uses the chat's
 * saved folder, else its scratch folder). Only what is loaded counts.
 */
export function chatProjectOf(conversationId: string): string {
  const folder = useChatFolders.getState().byConversation[conversationId];
  return folder?.kind === "project" ? folder.path : "";
}

/**
 * Whether a chat works in a project, so it is Code's: its agent works quietly there, and it lists
 * on the Code page. Only what is loaded counts.
 */
export function isProjectChat(conversationId: string): boolean {
  const state = useChatFolders.getState();
  return (
    state.byConversation[conversationId]?.kind === "project" ||
    Boolean(state.projectChats?.[conversationId])
  );
}

/**
 * A chat's folder, loaded on first use: its project, or its scratch folder, which reading it
 * makes. `folder` is "" while it is read. A new chat with no id shows the project it will use,
 * else nothing. `failed` says it couldn't be read; `retry` reads it again.
 */
export function useChatFolder(conversationId: string | null | undefined): {
  folder: string;
  kind: ChatFolderKind;
  loaded: boolean;
  failed: boolean;
  retry(): void;
} {
  const draft = isDraftChat(conversationId);
  const id = draft ? "" : conversationId!;
  const saved = useChatFolders((state) => (id ? state.byConversation[id] : undefined));
  const failed = useChatFolders((state) => (id ? state.failed[id] === true : false));
  const draftPath = useChatFolders((state) => state.draft);
  const retry = useCallback(() => {
    if (id)
      void useChatFolders
        .getState()
        .load(id)
        .catch(() => undefined);
  }, [id]);
  useEffect(() => {
    if (id && !useChatFolders.getState().byConversation[id]) retry();
  }, [id, retry]);
  if (draft)
    return {
      folder: draftPath ?? "",
      kind: draftPath ? "project" : "scratch",
      loaded: true,
      failed: false,
      retry,
    };
  if (!saved) return { folder: "", kind: "scratch", loaded: false, failed, retry };
  return {
    // Reading a chat's folder makes its scratch folder, so it is always there to open.
    folder: saved.path,
    kind: saved.kind,
    loaded: true,
    failed: false,
    retry,
  };
}

/** The person's projects, most recently used first, read on first use; null until then. */
export function useProjectFolders(): ProjectFolder[] | null {
  const accountId = useAgentAccountId();
  const projects = useChatFolders((state) => state.projects);
  useEffect(() => {
    if (accountId && useChatFolders.getState().projects === null)
      void useChatFolders
        .getState()
        .loadProjects()
        .catch(() => undefined);
  }, [accountId]);
  return projects;
}

/**
 * The chats that work in a project, by id with the project's path, read on first use; null until
 * then. Those are Code's: the Code page lists them, the sidebar never does.
 */
export function useProjectChats(): Record<string, string> | null {
  const accountId = useAgentAccountId();
  const projectChats = useChatFolders((state) => state.projectChats);
  // Read whenever there is no list: on first use, and after an account change clears it, even
  // one this hook's account id never showed (it can change and change back between renders).
  const missing = projectChats === null;
  useEffect(() => {
    if (!accountId || !missing) return;
    // The sidebar waits on this list, so a failed read (the native side still starting) is tried
    // again, twice as long each time up to 30s, never taken for "no project chats".
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const read = () =>
      void useChatFolders
        .getState()
        .loadProjectChats()
        .catch((reason: unknown) => {
          if (stopped) return;
          console.warn("[chats] couldn't read which chats work in a project", reason);
          timer = setTimeout(read, Math.min(30_000, 1_000 * 2 ** attempt++));
        });
    read();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [accountId, missing]);
  return projectChats;
}

const noProjects: string[] = [];

/**
 * The person's project folders and the most recently used one, for engine settings that read a
 * folder's own config (`engine-config/host.ts`).
 */
export function useLinkedFolders(): { folders: string[]; picked?: string } {
  const projects = useProjectFolders();
  return useMemo(() => {
    const folders = projects?.map((project) => project.path) ?? noProjects;
    return { folders, picked: folders[0] };
  }, [projects]);
}
