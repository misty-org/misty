import { useCallback, useEffect, useMemo } from "react";
import { create } from "zustand";
import { useUserStore } from "@/features/account/core";
import { invoke } from "@/native/invoke";
import { agentAccountId, useAgentAccountId } from "../personal/agent_account";

export type ChatFolderKind = "project" | "scratch";

export interface ChatFolder {
  path: string;
  kind: ChatFolderKind;
}

export interface ProjectFolder {
  path: string;
  lastUsedAt: number;
}

export const isDraftChat = (conversationId: string | null | undefined) =>
  !conversationId || conversationId === "draft";

interface ChatFoldersState {
  byConversation: Record<string, ChatFolder>;
  failed: Record<string, boolean>;
  draft: string | null;
  projects: ProjectFolder[] | null;
  projectChats: Record<string, string> | null;
  loadProjectChats(): Promise<Record<string, string>>;
  load(conversationId: string): Promise<ChatFolder>;
  loadProjects(): Promise<ProjectFolder[]>;
  choose(conversationId: string | undefined): Promise<string | null>;
  addProject(): Promise<string | null>;
  use(conversationId: string | undefined, path: string): Promise<void>;
  scratch(conversationId: string | undefined): Promise<void>;
  forgetProject(path: string): Promise<void>;
  adoptDraft(conversationId: string): void;
  pickProjectParent(): Promise<string | null>;
  openInCode(conversationId: string, parent: string, name: string): Promise<string>;
}

const account = () => agentAccountId();

const reading = new Map<string, Promise<ChatFolder>>();

const readingProjectChats = new Map<string, Promise<Record<string, string>>>();

export const useChatFolders = create<ChatFoldersState>((set, get) => {
  const keep = (conversationId: string, folder: ChatFolder) => {
    const projectChats = get().projectChats;
    set({
      byConversation: { ...get().byConversation, [conversationId]: folder },
      failed: { ...get().failed, [conversationId]: false },
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

export function chatProjectOf(conversationId: string): string {
  const folder = useChatFolders.getState().byConversation[conversationId];
  return folder?.kind === "project" ? folder.path : "";
}

export function isProjectChat(conversationId: string): boolean {
  const state = useChatFolders.getState();
  return (
    state.byConversation[conversationId]?.kind === "project" ||
    Boolean(state.projectChats?.[conversationId])
  );
}

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
    folder: saved.path,
    kind: saved.kind,
    loaded: true,
    failed: false,
    retry,
  };
}

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

export function useProjectChats(): Record<string, string> | null {
  const accountId = useAgentAccountId();
  const projectChats = useChatFolders((state) => state.projectChats);
  const missing = projectChats === null;
  useEffect(() => {
    if (!accountId || !missing) return;
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

export function useLinkedFolders(): { folders: string[]; picked?: string } {
  const projects = useProjectFolders();
  return useMemo(() => {
    const folders = projects?.map((project) => project.path) ?? noProjects;
    return { folders, picked: folders[0] };
  }, [projects]);
}
