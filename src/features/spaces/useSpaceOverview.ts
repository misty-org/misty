import { readApiSessionGeneration } from "@/api/client/session";
import { useLocation } from "react-router-dom";
import { useWorkspaceViewFocused } from "@/features/workspace/WorkspaceViewRouteScope";
import { useSpacePersonalItems } from "./useSpacePersonalItems";
import { spaceItemKeyFromRoute } from "./spaceItemRoute";
import { spaceChatConversationPath } from "./chat/chatRoute";
import { conversationName } from "./chat/sidebar/conversationGroups";
import { notesApi } from "@/api/notes/api";
import { drawingsApi } from "@/api/drawings/api";
import { spacesApi } from "@/api/spaces/api";
import type { Space, SpaceLibraryItem } from "@/api/spaces/dto/interfaces/types";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type SpaceOverviewItem = {
  id: string;
  title: string;
  area: "Chat" | "Planner" | "Journal" | "Library";
  kind: "note" | "drawing" | "task" | "file" | "chat";
  updatedAt: string;
  createdAt?: string;
  dueAt?: string;
  assigneeUserId?: string;
  completed?: boolean;
  libraryItem?: SpaceLibraryItem;
  creatorUserId?: string;
  creatorAgentId?: string;
  route: string;
  rename?: (title: string) => Promise<unknown>;
  renameRoute?: string;
  remove?: () => Promise<unknown>;
  favorite?: boolean;
  toggleFavorite?: () => Promise<unknown>;
};

/** Pane-scoped reads never change the active editor's global store. */
const OverviewContext = createContext<{
  accountId: string;
  spaceId: string;
  data: ReturnType<typeof useSpaceOverviewData>;
} | null>(null);
export function SpaceOverviewProvider({
  accountId,
  space,
  children,
}: {
  accountId: string;
  space: Space;
  children: ReactNode;
}) {
  const data = useSpaceOverviewData(accountId, space, true);
  const location = useLocation();
  const focused = useWorkspaceViewFocused();
  const personal = useSpacePersonalItems(space.id);
  const activeKey = spaceItemKeyFromRoute(location.pathname + location.search, space.id);
  const valid = data.items.some((item) => item.id === activeKey);
  const lastVisit = useRef("");
  const updateRef = useRef(personal.update);
  updateRef.current = personal.update;
  useEffect(() => {
    const visit = `${accountId}:${space.id}:${activeKey}`;
    if (!focused || !valid || !activeKey || !accountId) {
      lastVisit.current = "";
      return;
    }
    if (lastVisit.current === visit) return;
    lastVisit.current = visit;
    void updateRef.current(activeKey, { opened: true }).catch(() => {
      lastVisit.current = "";
    });
  }, [focused, valid, activeKey, space.id, accountId]);
  return createElement(
    OverviewContext.Provider,
    { value: { accountId, spaceId: space.id, data } },
    children,
  );
}
export function useSpaceOverview(
  accountId: string,
  space: Pick<Space, "id"> & Partial<Space>,
  area?: "Journal",
) {
  const shared = useContext(OverviewContext);
  const matches = shared?.accountId === accountId && shared?.spaceId === space.id;
  const fallback = useSpaceOverviewData(accountId, space, !matches, area);
  return matches ? shared!.data : fallback;
}
function useSpaceOverviewData(
  accountId: string,
  space: Pick<Space, "id"> & Partial<Space>,
  enabled: boolean,
  area?: "Journal",
) {
  const canChat = !area && space.permissions?.["messages.read"] !== false;
  const canPlan = !area && space.permissions?.["tasks.view"] !== false;
  const canRead = !area && space.permissions?.["library.view"] !== false;
  const scope = JSON.stringify([
    readApiSessionGeneration(),
    accountId,
    space.id,
    space.role,
    space.permissions,
    area,
  ]);
  const [result, setResult] = useState<{
    scope: string;
    items: SpaceOverviewItem[];
    failed: boolean;
  }>();
  const [attempt, retry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let generation = 0;
    const base = `/spaces/${encodeURIComponent(space.id)}`;
    const read = async () => {
      const current = ++generation;
      const requests: Promise<SpaceOverviewItem[]>[] = [
        notesApi.list(space.id).then(({ notes }) =>
          notes
            .filter((n) => n.lifecycle_state === "active")
            .map((n) => ({
              id: `note:${n.id}`,
              title: n.title || "Untitled note",
              area: "Journal",
              kind: "note",
              creatorUserId: n.creator_user_id,
              createdAt: n.created_at,
              updatedAt: n.updated_at || n.created_at || "",
              route: `${base}/notes?note=${encodeURIComponent(n.id)}&view=doc`,
              renameRoute:
                n.role === "creator" || n.role === "editor"
                  ? `${base}/notes?note=${encodeURIComponent(n.id)}&view=doc&rename=1`
                  : undefined,
              remove:
                (n.can_delete ?? n.role === "creator")
                  ? () => notesApi.remove(space.id, n.id)
                  : undefined,
            })),
        ),
        drawingsApi.list(space.id).then(({ drawings }) =>
          drawings
            .filter((d) => d.lifecycle_state === "active")
            .map((d) => ({
              id: `drawing:${d.id}`,
              title: d.title || "Untitled drawing",
              area: "Journal",
              kind: "drawing",
              creatorUserId: d.creator_user_id,
              createdAt: d.created_at,
              updatedAt: d.updated_at,
              route: `${base}/drawings/${encodeURIComponent(d.id)}`,
              rename:
                d.role === "creator" || d.role === "editor"
                  ? (title: string) => drawingsApi.rename(space.id, d.id, title)
                  : undefined,
              remove: d.can_delete ? () => drawingsApi.remove(space.id, d.id) : undefined,
            })),
        ),
      ];
      if (canChat)
        requests.push(
          spacesApi.conversations(space.id).then(({ conversations }) =>
            conversations
              .filter((c) => !c.direct_agent_id)
              .map((c) => ({
                id: `chat:${c.id}`,
                title: conversationName(c, accountId),
                area: "Chat",
                kind: "chat",
                creatorUserId: c.created_by_user_id,
                createdAt: c.created_at,
                updatedAt: c.updated_at,
                route: spaceChatConversationPath(space.id, c.id),
                rename:
                  c.created_by_user_id === accountId && c.kind !== "direct"
                    ? (title: string) =>
                        spacesApi.updateConversation(
                          space.id,
                          c.id,
                          title,
                          c.participants
                            .filter((p) => p.user_id)
                            .map((p) => ({ kind: "person", user_id: p.user_id! })),
                        )
                    : undefined,
                remove:
                  space.role === "owner" ||
                  c.created_by_user_id === accountId ||
                  c.kind === "direct"
                    ? () => spacesApi.deleteOrClearConversation(space.id, c.id)
                    : undefined,
              })),
          ),
        );
      if (canPlan)
        requests.push(
          readAllTasks(space.id).then(({ tasks }) =>
            tasks
              .filter((t) => !t.archived_at)
              .map((t) => ({
                id: `task:${t.id}`,
                title: t.title,
                dueAt: t.due_at,
                assigneeUserId: t.assignee_user_id,
                completed: Boolean(t.completed_at) || t.status === "done",
                area: "Planner",
                kind: "task",
                creatorUserId: t.created_by_user_id,
                creatorAgentId: t.created_by_agent_id,
                createdAt: t.created_at,
                updatedAt: t.updated_at,
                route: `${base}/planner/tasks/list?task=${encodeURIComponent(t.id)}`,
                rename:
                  space.role === "owner" || space.permissions?.["tasks.manage"] === true
                    ? (title: string) => spacesApi.updateTask(space.id, t, { title })
                    : undefined,
                remove:
                  space.role === "owner" || space.permissions?.["tasks.manage"] === true
                    ? () => spacesApi.archiveTask(space.id, t)
                    : undefined,
              })),
          ),
        );
      if (canRead)
        requests.push(
          readAllLibraryItems(space.id).then(({ items }) =>
            items
              .filter((i) => !i.hidden && !i.trashed_at)
              .map((i) => ({
                id: `file:${i.id}`,
                libraryItem: i,
                title: i.display_name,
                area: "Library",
                kind: "file",
                creatorUserId: i.added_by_user_id,
                createdAt: i.added_at,
                updatedAt: i.updated_at,
                route: `${base}/library?item=${encodeURIComponent(i.id)}`,
                rename:
                  space.permissions?.["library.edit"] !== false
                    ? (title: string) =>
                        spacesApi.updateLibraryItem(space.id, i, { display_name: title })
                    : undefined,
                remove:
                  space.permissions?.["library.edit"] !== false
                    ? () => spacesApi.trashLibraryItem(space.id, i.id)
                    : undefined,
              })),
          ),
        );
      const results = await Promise.allSettled(requests);
      if (!active || current !== generation) return;
      const items: SpaceOverviewItem[] = results.flatMap((r) =>
        r.status === "fulfilled" ? r.value : [],
      );
      if (canChat)
        items.push({
          id: "chat:everyone",
          title: "Everyone",
          area: "Chat",
          kind: "chat",
          updatedAt: "",
          route: `${base}/social/misty`,
        });
      items.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
      setResult({ scope, items, failed: results.some((r) => r.status === "rejected") });
    };
    void read();
    const refresh = (event: Event) => {
      const id = (event as CustomEvent<{ space_id?: string }>).detail?.space_id;
      if (!id || id === space.id) void read();
    };
    const events = [
      "misty:refresh-focused-tool",
      "misty:space-note-event",
      "misty:space-drawing-event",
      "misty:space-task-event",
      "misty:space-library-event",
      "misty:space-conversation-event",
    ];
    events.forEach((name) => window.addEventListener(name, refresh));
    return () => {
      active = false;
      events.forEach((name) => window.removeEventListener(name, refresh));
    };
  }, [
    scope,
    enabled,
    accountId,
    space.id,
    space.role,
    space.permissions,
    canChat,
    canPlan,
    canRead,
    attempt,
  ]);
  return {
    items: result?.scope === scope ? result.items : [],
    loading: result?.scope !== scope,
    failed: result?.scope === scope && result.failed,
    retry: () => retry((n) => n + 1),
  };
}

async function readAllTasks(spaceId: string) {
  const tasks: Awaited<ReturnType<typeof spacesApi.tasks>>["tasks"] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await spacesApi.tasks(spaceId, { sort: "updated", limit: 200, cursor });
    tasks.push(...page.tasks);
    cursor = page.next_cursor;
    if (cursor && seen.has(cursor)) throw new Error("Task pagination did not advance");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return { tasks };
}
async function readAllLibraryItems(spaceId: string) {
  const items: SpaceLibraryItem[] = [];
  let after: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await spacesApi.libraryItems(spaceId, {
      limit: 200,
      visibility: "visible",
      after,
    });
    items.push(...page.items);
    after = page.next_after;
    if (after && seen.has(after)) throw new Error("Library pagination did not advance");
    if (after) seen.add(after);
  } while (after);
  return { items };
}
