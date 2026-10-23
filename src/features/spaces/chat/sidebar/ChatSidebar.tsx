import { ChevronDown, Hash, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";
import { useState, type ReactNode } from "react";
import type { SpaceConversation } from "@/api/spaces/dto/entities";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Pressable,
  SkeletonList,
  WorkspaceSidebar,
  cn,
} from "@/shared/ui";
import { conversationName, groupConversations } from "./conversationGroups";
import { readChatSidebar, writeChatSidebar } from "./chatSidebarPreferences";

/** "everyone" is the Space-wide channel; anything else is a conversation id. */
export type ChatSelection = string;

/**
 * The chat page's sidebar, like Slack: a collapsible Channels section with the Space-wide
 * channel and every conversation with people. Agents are not here; mention one in a message.
 */
export function ChatSidebar(props: {
  spaceName: string;
  conversations: SpaceConversation[];
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
}) {
  const [collapsed, setCollapsed] = useState(() => readChatSidebar());
  const [channels] = groupConversations(props.conversations);
  const toggleSection = (id: string) => {
    const next = { ...collapsed, [id]: !collapsed[id] };
    setCollapsed(next);
    writeChatSidebar(next);
  };
  const channelRow = (id: string, label: string, conversation?: SpaceConversation) => (
    <Row
      key={id}
      active={props.selected === id}
      selected={props.selectedIds.includes(id)}
      onClick={(event) => {
        if (conversation && props.isOwner) props.onRangeSelect(event, id, () => props.onSelect(id));
        else props.onSelect(id);
      }}
      icon={<Hash />}
      trailing={
        conversation && props.isOwner ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                label={`More for ${label}`}
                size="xs"
                className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [&_svg]:size-3.5"
              >
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => props.onEdit(conversation)}>
                <Pencil />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => props.onDelete(conversation)}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : undefined
      }
    >
      {label}
    </Row>
  );
  return (
    <WorkspaceSidebar aria-label={`Chats in ${props.spaceName}`} className="gap-1">
      {props.selectedIds.length ? (
        <div className="mx-1 mb-2 flex items-center gap-2 rounded-lg bg-charcoal-card px-2 py-1.5">
          <span className="text-xs">{props.selectedIds.length} selected</span>
          <button
            type="button"
            className="ml-auto rounded px-2 py-1 text-xs hover:bg-charcoal-hover"
            onClick={() => props.onDeleteMany(props.selectedIds)}
          >
            Delete
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-cream-muted hover:bg-charcoal-hover"
            onClick={props.onClearSelection}
          >
            Clear
          </button>
        </div>
      ) : null}
      <Section
        title="Channels"
        collapsed={collapsed.channels}
        onToggle={() => toggleSection("channels")}
        action={
          props.canWrite && (
            <IconButton label="New channel" size="xs" onClick={props.onNewConversation}>
              <Plus />
            </IconButton>
          )
        }
      >
        {channelRow("everyone", "everyone")}
        {props.loading && props.conversations.length === 0 ? (
          <SkeletonList label="Channels" rows={3} lines={1} />
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
    </WorkspaceSidebar>
  );
}

function Section(props: {
  title: string;
  collapsed?: boolean;
  onToggle(): void;
  action?: ReactNode;
  children: ReactNode;
}) {
  // The category header: the name in title case, a chevron right after it, and + on hover.
  return (
    <section className="group/section mt-4 first:mt-1">
      <div className="flex h-7 items-center pr-1">
        <Pressable
          aria-expanded={!props.collapsed}
          onClick={props.onToggle}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-0.5 pl-2 text-[13px] font-medium",
            "text-cream-muted hover:text-cream",
          )}
        >
          <span className="truncate">{props.title}</span>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 transition-transform",
              props.collapsed && "-rotate-90",
            )}
          />
        </Pressable>
        <span className="opacity-0 group-hover/section:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100 [&_svg]:size-3.5">
          {props.action}
        </span>
      </div>
      <Collapse open={!props.collapsed}>
        <div className="flex flex-col gap-1 pt-1">{props.children}</div>
      </Collapse>
    </section>
  );
}

/** Folds its children away smoothly: the row height eases between 0 and its natural size. */
function Collapse(props: { open: boolean; children: ReactNode }) {
  return (
    <div
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

function Row(props: {
  active: boolean;
  selected?: boolean;
  onClick(event: MouseEvent): void;
  icon: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group/row flex h-8 min-w-0 items-center rounded-md pr-1",
        props.active || props.selected
          ? "bg-charcoal-active text-cream-bright"
          : "text-cream-muted hover:bg-charcoal-hover hover:text-cream",
      )}
    >
      <Pressable
        aria-current={props.active ? "page" : undefined}
        aria-pressed={props.selected}
        onClick={props.onClick}
        className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left text-sm"
      >
        <span
          aria-hidden
          className={cn(
            "grid size-5 shrink-0 place-items-center [&_svg]:size-4",
            "[&_.agent-avatar]:!size-5 [&_.agent-avatar]:text-[10px] [&_.agent-avatar_img]:object-contain",
          )}
        >
          {props.icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{props.children}</span>
      </Pressable>
      {props.trailing}
    </div>
  );
}
