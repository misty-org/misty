import { AccountCollectionFilters as CollectionFilters } from "@/features/settings/AccountCollectionFilters";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Hash, MessagesSquare, MoreHorizontal, Plus, User, Users } from "lucide-react";
import {
  Button,
  CollectionPage,
  CollectionHeading,
  CollectionSearch,
  useCollectionRefinement,
  CollectionItems,
  CollectionViewToggle,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  IconButton,
  Spinner,
} from "@/shared/ui";
import { useAuth } from "@/features/auth";
import { useSpacesStore } from "../store/useSpacesStore";
import { useSpaceItemCreator } from "../useSpaceItemCreator";
import {
  socialConversationPath,
  socialProvider,
  socialProviderFromRoute,
  socialProviderPath,
} from "../social/socialRoute";
import { useSpaceConversations } from "./sidebar/useSpaceConversations";
import { conversationName } from "./sidebar/conversationGroups";
import { CreateEditConversationDialog } from "./sidebar/CreateEditConversationDialog";
import { SpaceSocial } from "./SpaceChat";
import type { SpaceConversation } from "@/api/spaces/dto/interfaces/types";

export function SpaceChatEntry(props: React.ComponentProps<typeof SpaceSocial>) {
  const location = useLocation();
  const detail = Boolean(
    location.pathname.split("/")[4] || new URLSearchParams(location.search).has("conversation"),
  );
  if (detail)
    return <SpaceSocial {...props} provider={socialProviderFromRoute(location.pathname)} />;
  return <ChatCollection key={props.spaceId} spaceId={props.spaceId} />;
}
export function ChatCollection({ spaceId }: { spaceId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const space = useSpacesStore((s) => s.spaces.find((x) => x.id === spaceId));
  const members = useSpacesStore((s) => s.membersBySpace[spaceId]);
  const loadMembers = useSpacesStore((s) => s.loadMembers);
  const data = useSpaceConversations(spaceId, space?.permissions?.["messages.read"] !== false);
  const creator = useSpaceItemCreator(spaceId);
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("All");
  const [view, setView] = useState<"list" | "grid">("list");
  const [editing, setEditing] = useState<SpaceConversation | null>();
  useEffect(() => {
    if (!members) void loadMembers(spaceId).catch(() => {});
  }, [members, loadMembers, spaceId]);
  const rows = data.conversations
    .filter((c) => !c.direct_agent_id)
    .map((c) => {
      const provider = socialProvider(c.origin) ?? "misty";
      const category =
        provider !== "misty" ? "Connected" : c.kind === "direct" ? "Direct" : "Channels";
      const open = () => navigate(socialConversationPath(spaceId, provider, c.id));
      return {
        id: c.id,
        title: conversationName(c, user?.id),
        category,
        icon:
          category === "Channels" ? (
            <Hash />
          ) : category === "Direct" ? (
            <User />
          ) : (
            <MessagesSquare />
          ),
        creator: creator(c.created_by_user_id),
        metadata: {
          Members: c.participants.length,
          Source:
            provider === "misty" ? "Misty" : provider.charAt(0).toUpperCase() + provider.slice(1),
          Created: new Date(c.created_at).toLocaleDateString(),
        },
        sortValues: { Created: Date.parse(c.created_at) },
        timestamp: c.updated_at,
        ownership: c.created_by_user_id === user?.id ? "mine" : "others",
        updatedAt: c.updated_at,
        updated: new Date(c.updated_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        onOpen: open,
        actions: (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`More actions for ${conversationName(c, user?.id)}`}>
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={open}>Open</DropdownMenuItem>
              {c.created_by_user_id === user?.id && c.kind !== "direct" && provider === "misty" && (
                <DropdownMenuItem onSelect={() => setEditing(c)}>
                  Edit conversation
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      };
    });
  rows.unshift({
    id: "everyone",
    title: "Everyone",
    category: "Channels",
    icon: <Users />,
    creator: "Space members",
    metadata: { Members: members?.length ?? 0, Source: "Misty", Created: "—" },
    sortValues: { Created: NaN },
    timestamp: "",
    ownership: "others",
    updatedAt: "",
    updated: "—",
    onOpen: () => navigate(socialProviderPath(spaceId, "misty")),
    actions: <></>,
  });
  const searched = rows.filter(
    (r) =>
      (section === "All" || r.category === section) &&
      r.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const refinement = useCollectionRefinement(searched, {
    label: "Filter chats",
    title: (row) => row.title,
    date: (row) => row.timestamp,
    facet: {
      label: "Created by",
      value: (row) => row.ownership,
      options: [
        { value: "all", label: "Anyone" },
        { value: "mine", label: "Me" },
        { value: "others", label: "Others" },
      ],
    },
  });
  const visible = refinement.items;
  return (
    <CollectionPage>
      <CollectionHeading
        title="Chat"
        actions={
          <>
            <CollectionSearch
              aria-label="Search chat"
              placeholder="Search chat"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {space?.permissions?.["messages.write"] !== false && (
              <Button variant="primary" className="px-4" onClick={() => setEditing(null)}>
                <Plus />
                New chat
              </Button>
            )}
          </>
        }
      />
      <CollectionFilters
        collectionId="chat"
        value={section}
        options={["All", "Channels", "Direct", "Connected"].map((label) => ({
          value: label,
          label,
        }))}
        onChange={setSection}
        filterControl={refinement.control}
        actions={<CollectionViewToggle value={view} onChange={setView} />}
      />
      {data.error && (
        <div role="alert" className="flex items-center gap-3 text-sm">
          {data.error}
          <Button variant="outline" size="sm" onClick={data.retry}>
            Retry
          </Button>
        </div>
      )}
      {data.loading ? (
        <Spinner label="Loading chats" />
      ) : (
        <CollectionItems
          columnSetId="chats"
          fields={["Members", "Source", "Created"]}
          sortResetKey={refinement.sortKey}
          categoryLabel="Type"
          view={view}
          items={visible}
        />
      )}
      <CreateEditConversationDialog
        spaceId={spaceId}
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        members={members ?? []}
        currentUserId={user?.id}
        conversation={editing}
        onSaved={(saved) => {
          data.upsert(saved);
          setEditing(undefined);
          navigate(socialConversationPath(spaceId, "misty", saved.id));
        }}
      />
    </CollectionPage>
  );
}
