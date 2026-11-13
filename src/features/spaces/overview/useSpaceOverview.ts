import { useLocation } from "react-router-dom";
import { useWorkspaceViewFocused } from "@/features/app-windows";
import { useSpacePersonalItems } from "./useSpacePersonalItems";
import { spaceItemKeyFromRoute } from "../routes/spaceItemRoute";
import { conversationPath } from "../chat/chatRoute";
import { conversationName } from "../chat/sidebar/conversationGroups";
import { notesApi } from "../journal/notes/api/api";
import { useSpaceNoteList } from "../journal/notes/api/notesResource";
import { drawingsApi } from "../journal/drawings/api/api";
import { useSpaceDrawingList } from "../journal/drawings/api/drawingsResource";
import { useSpaceConversationList } from "../chat/spaceConversationsResource";
import { spacesApi } from "../api/api";
import { libraryItemsPath } from "../api/library-items-query";
import { useSpaceResource } from "../api/spaceResource";
import {
  agentArtifactCredit,
  type SpaceAgentArtifact,
  useSpaceAgentArtifacts,
} from "../api/agent-artifacts";
import type { Space, SpaceLibraryItem } from "../api/dto/entities";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

export type SpaceOverviewItem = {
  id: string;
  title: string;
  area: "Chat" | "Journal" | "Library";
  kind: "note" | "drawing" | "file" | "chat";
  updatedAt: string;
  createdAt?: string;
  libraryItem?: SpaceLibraryItem;
  creatorUserId?: string;
  creatorAgentId?: string;
  /** Who made an item an agent saved, e.g. "Researcher, Bob’s agent". */
  creatorAgentName?: string;
  route: string;
  rename?: (title: string) => Promise<unknown>;
  renameRoute?: string;
  remove?: () => Promise<unknown>;
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
  const personal = useSpacePersonalItems(space.id);
  const activeKey = spaceItemKeyFromRoute(location.pathname + location.search, space.id);
  const valid = data.items.some((item) => item.id === activeKey);
  return createElement(
    OverviewContext.Provider,
    { value: { accountId, spaceId: space.id, data } },
    createElement(OpenedItemVisit, {
      visit: valid && activeKey && accountId ? `${accountId}:${space.id}:${activeKey}` : "",
      itemKey: activeKey,
      update: personal.update,
    }),
    children,
  );
}

/**
 * Records the open item as opened while its tab has focus. Focus is read here rather than by the
 * provider, so a tab gaining or losing focus renders this alone, not the whole Space page.
 */
function OpenedItemVisit(props: {
  visit: string;
  itemKey: string | null | undefined;
  update: ReturnType<typeof useSpacePersonalItems>["update"];
}) {
  const focused = useWorkspaceViewFocused();
  const lastVisit = useRef("");
  const updateRef = useRef(props.update);
  updateRef.current = props.update;
  const { visit, itemKey } = props;
  useEffect(() => {
    if (!focused || !visit || !itemKey) {
      lastVisit.current = "";
      return;
    }
    if (lastVisit.current === visit) return;
    lastVisit.current = visit;
    void updateRef.current(itemKey, { opened: true }).catch(() => {
      lastVisit.current = "";
    });
  }, [focused, visit, itemKey]);
  return null;
}
export function useSpaceOverview(
  accountId: string,
  space: Pick<Space, "id"> & Partial<Space>,
  area?: "Journal",
) {
  const shared = useContext(OverviewContext);
  // The shared copy covers every area; one area alone (the Journal) reads only its own sources,
  // so it shows as soon as they are in rather than waiting on every Library page.
  const matches = !area && shared?.accountId === accountId && shared?.spaceId === space.id;
  const fallback = useSpaceOverviewData(accountId, space, !matches, area);
  return matches ? shared!.data : fallback;
}

const noArtifacts: SpaceAgentArtifact[] = [];

/**
 * The Space's items for its overview, from each source's cached copy: the last lists paint at
 * once on a revisit or relaunch and fresh ones load behind them. `loading` is true only while a
 * source the area needs has nothing to show yet.
 */
function useSpaceOverviewData(
  accountId: string,
  space: Pick<Space, "id"> & Partial<Space>,
  enabled: boolean,
  area?: "Journal",
) {
  const allAreas = !area;
  const spaceId = enabled ? space.id : "";
  const libraryId = enabled && allAreas ? space.id : "";
  const base = `/spaces/${encodeURIComponent(space.id)}`;
  const notes = useSpaceNoteList(spaceId);
  const drawings = useSpaceDrawingList(spaceId);
  const conversations = useSpaceConversationList(libraryId);
  const library = useSpaceResource(
    libraryId ? `${libraryItemsPath(space.id, { visibility: "visible" })}&pages=all` : null,
    () => readAllLibraryItems(space.id).then(({ items }) => items),
  );
  // Files agents saved keep who made them; the list itself still loads without it.
  const artifacts = useSpaceAgentArtifacts(libraryId);
  const sources = allAreas
    ? [notes, drawings, conversations, library, artifacts]
    : [notes, drawings];

  const reloadNotes = notes.reload;
  const reloadDrawings = drawings.reload;
  const reloadConversations = conversations.reload;
  const reloadLibrary = library.reload;
  useEffect(() => {
    if (!enabled) return;
    type Reload = () => Promise<unknown>;
    const journalReloads: Reload[] = [reloadNotes, reloadDrawings];
    const otherReloads: Reload[] = allAreas ? [reloadConversations, reloadLibrary] : [];
    const sourcesFor: Record<string, Reload[]> = {
      "misty:refresh-focused-tool": [...journalReloads, ...otherReloads],
      "misty:space-note-event": [reloadNotes],
      "misty:space-drawing-event": [reloadDrawings],
      "misty:space-library-event": allAreas ? [reloadLibrary] : [],
      "misty:space-conversation-event": allAreas ? [reloadConversations] : [],
    };
    const listeners = Object.entries(sourcesFor).map(([name, reloads]) => {
      const refresh = (event: Event) => {
        const id = (event as CustomEvent<{ space_id?: string }>).detail?.space_id;
        if (!id || id === space.id) reloads.forEach((reload) => void reload());
      };
      window.addEventListener(name, refresh);
      return () => window.removeEventListener(name, refresh);
    });
    return () => listeners.forEach((remove) => remove());
  }, [
    allAreas,
    enabled,
    reloadConversations,
    reloadDrawings,
    reloadLibrary,
    reloadNotes,
    space.id,
  ]);

  const items = useMemo(() => {
    const result: SpaceOverviewItem[] = [];
    for (const n of notes.data ?? []) {
      if (n.lifecycle_state !== "active") continue;
      result.push({
        id: `note:${n.id}`,
        title: n.title || "Untitled doc",
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
      });
    }
    for (const d of drawings.data ?? []) {
      if (d.lifecycle_state !== "active") continue;
      result.push({
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
      });
    }
    if (allAreas) {
      for (const c of conversations.data ?? [])
        result.push({
          id: `chat:${c.id}`,
          title: conversationName(c, accountId),
          area: "Chat",
          kind: "chat",
          creatorUserId: c.created_by_user_id,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
          route: conversationPath(space.id, c),
          rename:
            c.created_by_user_id === accountId && c.kind !== "dm"
              ? (title: string) => spacesApi.updateConversation(space.id, c.id, title)
              : undefined,
          remove:
            space.role === "owner" || c.created_by_user_id === accountId || c.kind === "dm"
              ? () => spacesApi.deleteOrClearConversation(space.id, c.id)
              : undefined,
        });
      const madeBy = artifacts.data ?? noArtifacts;
      for (const i of library.data ?? []) {
        if (i.hidden || i.trashed_at) continue;
        const artifact = madeBy.find((candidate) => candidate.item_id === i.id);
        result.push({
          id: `file:${i.id}`,
          libraryItem: i,
          title: i.display_name,
          area: "Library",
          kind: "file",
          creatorUserId: i.added_by_user_id,
          creatorAgentId: artifact?.agent_id ?? (artifact ? "agent" : undefined),
          creatorAgentName: artifact ? agentArtifactCredit(artifact, accountId) : undefined,
          createdAt: i.added_at,
          updatedAt: i.updated_at,
          route: `${base}/library?item=${encodeURIComponent(i.id)}`,
          rename: (title: string) =>
            spacesApi.updateLibraryItem(space.id, i, { display_name: title }),
          remove: () => spacesApi.trashLibraryItem(space.id, i.id),
        });
      }
      result.push({
        id: "chat:everyone",
        title: "Everyone",
        area: "Chat",
        kind: "chat",
        updatedAt: "",
        route: `${base}/social/misty`,
      });
    }
    result.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
    return result;
  }, [
    accountId,
    allAreas,
    artifacts.data,
    base,
    conversations.data,
    drawings.data,
    library.data,
    notes.data,
    space.id,
    space.role,
  ]);

  const loading = enabled && sources.some((source) => source.loading);
  const failed = !loading && sources.some((source) => Boolean(source.error));
  return {
    items: loading ? noItems : items,
    loading,
    failed,
    retry: () => {
      for (const source of sources) if (source.error) void source.reload();
    },
  };
}

const noItems: SpaceOverviewItem[] = [];

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
