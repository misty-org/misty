import { Hash, Pencil, Plus, Trash2, User } from "lucide-react";
import type { MouseEvent } from "react";
import { useId, type ReactNode } from "react";
import type { SpaceConversation } from "../../api/dto/entities";
import {
  Button,
  ListRow,
  MenuItem,
  SectionHeading,
  ListRowSkeleton,
  Surface,
  WorkspaceSidebar,
  cn,
  type RowState,
  type SectionHeadingAction,
} from "@/shared/ui";
import { conversationName, groupConversations } from "./conversationGroups";
import { useChatSidebarPreferences } from "./chatSidebarPreferences";

/** "everyone" is the Space-wide channel; anything else is a conversation id. */
type ChatSelection = string;

/**
 * The chat page's sidebar, like Slack: a collapsible Channels section with the Space-wide
 * channel and the group chats, public to the Space, and a Direct messages section, visible only
 * to the people in each. Agents are not here; mention one in a message.
 */
export function ChatSidebar(props: {
  spaceName: string;
  conversations: SpaceConversation[];
  /** Messages in Everyone the person hasn't read. */
  everyoneUnread: number;
  loading: boolean;
  currentUserId?: string;
  selected: ChatSelection;
  canWrite: boolean;
  /** Only the Space's owner renames or deletes a channel. */
  isOwner: boolean;
  onSelect(selection: ChatSelection): void;
  onEdit(conversation: SpaceConversation): void;
  onDelete(conversation: SpaceConversation): void;
  onDeleteMany(ids: string[]): void;
  selectedIds: string[];
  onRangeSelect(event: MouseEvent, id: string, onOpen: () => void): void;
  onClearSelection(): void;
  onNewConversation(): void;
  onNewDirectMessage(): void;
}) {
  const collapsed = useChatSidebarPreferences((state) => state.value);
  const saveCollapsed = useChatSidebarPreferences((state) => state.set);
  const [channels, directMessages] = groupConversations(props.conversations);
  const toggleSection = (id: string) =>
    saveCollapsed((current) => ({ ...current, [id]: !current[id] }));
  // The open chat is being read, so it never shows a mark, even before the server has the read.
  const unreadState = (id: string, count: number | undefined): RowState =>
    count && props.selected !== id
      ? { kind: "unread", label: `${count >= 100 ? "99+" : count} unread` }
      : { kind: "none" };
  const channelRow = (id: string, label: string, conversation?: SpaceConversation) => (
    <ListRow
      key={id}
      label={label}
      leading={Hash}
      selected={props.selected === id}
      state={unreadState(id, conversation ? conversation.unread_count : props.everyoneUnread)}
      checked={props.selectedIds.includes(id) || undefined}
      onOpen={(event) => {
        if (conversation && props.isOwner) props.onRangeSelect(event, id, () => props.onSelect(id));
        else props.onSelect(id);
      }}
      menuLabel={`More for ${label}`}
      menu={
        conversation && props.isOwner ? (
          <>
            <MenuItem icon={Pencil} label="Rename" onSelect={() => props.onEdit(conversation)} />
            <MenuItem icon={Trash2} label="Delete" onSelect={() => props.onDelete(conversation)} />
          </>
        ) : undefined
      }
    />
  );
  return (
    <WorkspaceSidebar aria-label={`Chats in ${props.spaceName}`} className="gap-1">
      {props.selectedIds.length ? (
        <Surface tone="card" radius="lg" className="mx-1 mb-2 flex items-center gap-2 px-2 py-1.5">
          <span className="text-xs">{props.selectedIds.length} selected</span>
          <Button
            variant="quiet"
            size="sm"
            className="ml-auto"
            onClick={() => props.onDeleteMany(props.selectedIds)}
          >
            Delete
          </Button>
          <Button variant="quiet" size="sm" onClick={props.onClearSelection}>
            Clear
          </Button>
        </Surface>
      ) : null}
      <Section
        title="Channels"
        tour="space-chat-channels"
        collapsed={collapsed.channels}
        onToggle={() => toggleSection("channels")}
        action={
          props.canWrite
            ? { label: "New channel", icon: Plus, onSelect: props.onNewConversation }
            : undefined
        }
      >
        {channelRow("everyone", "everyone")}
        {props.loading && props.conversations.length === 0 ? (
          <ListRowSkeleton label="Channels" rows={3} leading className="gap-1" />
        ) : (
          channels.conversations.map((conversation) =>
            channelRow(
              conversation.id,
              conversationName(conversation, props.currentUserId),
              conversation,
            ),
          )
        )}
      </Section>
      <Section
        title="Direct messages"
        tour="space-chat-dms"
        collapsed={collapsed.dms}
        onToggle={() => toggleSection("dms")}
        action={
          props.canWrite
            ? { label: "New direct message", icon: Plus, onSelect: props.onNewDirectMessage }
            : undefined
        }
      >
        {props.loading && props.conversations.length === 0 ? (
          <ListRowSkeleton label="Direct messages" rows={2} leading className="gap-1" />
        ) : null}
        {directMessages.conversations.map((conversation) => (
          <ListRow
            key={conversation.id}
            label={conversationName(conversation, props.currentUserId)}
            leading={User}
            selected={props.selected === conversation.id}
            state={unreadState(conversation.id, conversation.unread_count)}
            onOpen={() => props.onSelect(conversation.id)}
          />
        ))}
      </Section>
    </WorkspaceSidebar>
  );
}

function Section(props: {
  title: string;
  collapsed?: boolean;
  onToggle(): void;
  action?: SectionHeadingAction;
  /** The `data-tour` name a tour points at. */
  tour?: string;
  children: ReactNode;
}) {
  const contentId = useId();
  return (
    <section className="group/section mt-4 first:mt-1" data-tour={props.tour}>
      <SectionHeading
        title={props.title}
        open={!props.collapsed}
        onOpenChange={props.onToggle}
        controls={contentId}
        action={props.action}
      />
      <Collapse id={contentId} open={!props.collapsed}>
        <div className="flex flex-col gap-1 pt-1">{props.children}</div>
      </Collapse>
    </section>
  );
}

/** Folds its children away smoothly: the row height eases between 0 and its natural size. */
function Collapse(props: { id?: string; open: boolean; children: ReactNode }) {
  return (
    <div
      id={props.id}
      inert={!props.open}
      aria-hidden={!props.open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        props.open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden">{props.children}</div>
    </div>
  );
}
