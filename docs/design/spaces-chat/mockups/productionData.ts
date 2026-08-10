/** Fixture adapters are imported only by production.html, never by the app. */
import { spacesApi } from "@/api/spaces/api";
import { notesApi } from "@/api/notes/api";
import { drawingsApi } from "@/api/drawings/api";
import { spacePersonalItemsApi, type SpacePersonalItem } from "@/api/spaces/personalItems";
import { configureApiSession } from "@/api/client/session";
import { useSpacesStore } from "@/features/spaces/store/useSpacesStore";
import { useActivityStore } from "@/features/activity/useActivityStore";
import type { Space, SpaceConversation } from "@/api/spaces/dto/interfaces/types";
// All non-fixture API requests remain blocked, including accidental menu mutations.
configureApiSession({
  readGeneration: () => 999,
  isTransitioning: () => false,
  isSignedOut: () => true,
  readToken: () => new Promise(() => {}),
});
export const space: Space = {
  id: "preview",
  name: "family",
  owner_user_id: "me",
  role: "owner",
  is_default: false,
  member_count: 4,
  pending_count: 0,
  is_shared: true,
  created_at: "2026-09-01",
  updated_at: "2026-09-30",
  permissions: {},
};
export const conversations: SpaceConversation[] = [
  {
    id: "weekend",
    title: "Weekend plans",
    kind: "standard",
    participants: [],
    created_by_user_id: "me",
    space_id: "preview",
    origin: "misty",
    created_at: "2026-09-30",
    updated_at: "2026-09-30",
  },
  {
    id: "sam",
    title: "Sam Rivera",
    kind: "direct",
    participants: [],
    created_by_user_id: "sam",
    space_id: "preview",
    origin: "misty",
    created_at: "2026-09-30",
    updated_at: "2026-09-30",
  },
  {
    id: "discord",
    title: "Design updates",
    kind: "standard",
    participants: [],
    created_by_user_id: "me",
    space_id: "preview",
    origin: "discord",
    created_at: "2026-09-30",
    updated_at: "2026-09-30",
  },
];
const personal: SpacePersonalItem[] = [
  { item_key: "chat:weekend", favorite: true, opened_at: "2026-09-30T12:00:00Z" },
  { item_key: "note:packing", favorite: true, opened_at: "2026-09-30T11:00:00Z" },
  { item_key: "task:book", favorite: false, opened_at: "2026-09-30T10:00:00Z" },
];
spacePersonalItemsApi.list = async () => ({ items: [...personal] });
spacePersonalItemsApi.update = async (_space, key, patch) => {
  let item = personal.find((i) => i.item_key === key);
  if (!item) {
    item = { item_key: key, favorite: false };
    personal.push(item);
  }
  if (patch.favorite !== undefined) item.favorite = patch.favorite;
  if (patch.opened) item.opened_at = new Date().toISOString();
  return { ...item };
};
spacesApi.conversations = async () => ({ conversations });
spacesApi.tasks = async () => ({
  tasks: [
    {
      id: "book",
      space_id: "preview",
      title: "Reserve a picnic table",
      created_by_user_id: "me",
      assignee_user_id: "me",
      due_at: new Date().toISOString(),
      updated_at: "2026-09-30",
      status: "todo",
      priority: "low",
      task_number: 1,
      task_key: "FAM-1",
      notes: "",
      rank: 1,
      due_timezone: "America/Los_Angeles",
      source_refs: [],
      version: 1,
      created_at: "2026-09-30",
    },
  ],
  status_totals: { todo: 1, in_progress: 0, done: 0, canceled: 0 },
});
spacesApi.libraryItems = async () => ({ items: [] });
notesApi.list = async () =>
  ({
    notes: [
      {
        id: "packing",
        space_id: "preview",
        title: "A little list for Saturday",
        lifecycle_state: "active",
        creator_user_id: "me",
        role: "creator",
        can_delete: false,
        updated_at: "2026-09-30",
        created_at: "2026-09-30",
      },
    ],
  }) as Awaited<ReturnType<typeof notesApi.list>>;
drawingsApi.list = async () => ({ drawings: [] });
useSpacesStore.setState({
  spaces: [space],
  snapshotReady: true,
  referenceOnly: false,
  membersBySpace: { preview: [] },
  loadMembers: async () => {},
  presenceBySpace: { preview: [] },
});
useActivityStore.setState({
  attentionItems: [
    {
      id: "mention",
      accountId: "me",
      spaceId: "preview",
      source: "spaces",
      sourceId: "mention",
      kind: "mention",
      title: "Sam mentioned you",
      body: "Could you bring the blanket?",
      attention: true,
      createdAt: "2026-09-30",
      target: { kind: "space-chat", spaceId: "preview", conversationId: "weekend" },
    },
  ],
});
