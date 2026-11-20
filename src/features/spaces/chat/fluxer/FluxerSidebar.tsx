// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from Fluxer (https://github.com/fluxerapp/fluxer): features/app/components/layout/
// GuildNavbar.tsx, ChannelListContent.tsx, ChannelItem.tsx,
// GenericChannelItem.tsx, ChannelItemContent.tsx and ChannelItemIcon.tsx,
// features/guild/components/popouts/GuildHeaderPopout.tsx and features/channel/components/
// direct_message/DMListItem.tsx, wired to Misty's Spaces.
import { useState, type KeyboardEvent, type MouseEvent } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  ChevronDown,
  Hash,
  Lock,
  Plus,
  Settings,
  Trash2,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { Space, SpaceConversation } from "../../api/dto/entities";
import { spaceCan } from "../../roles/useSpaceRoles";
import { SpaceDialogs, type SpaceDialog } from "../../components/space-row/SpaceDialogs";
import {
  conversationName,
  groupConversations,
  isPrivateChannel,
} from "../sidebar/conversationGroups";
import { useChatSidebarPreferences } from "../sidebar/chatSidebarPreferences";
import { FluxerScroller } from "./FluxerScroller";
import { FluxerTooltip } from "./FluxerTooltip";
import { FluxerAvatar } from "./FluxerAvatar";
import { cx } from "./cx";
import navbar from "./css/GuildNavbar.module.css";
import popout from "./css/GuildHeaderPopout.module.css";
import list from "./css/ChannelListContent.module.css";
import item from "./css/ChannelItem.module.css";
import surface from "./css/ChannelItemSurface.module.css";
import itemIcon from "./css/ChannelItemIcon.module.css";
import dm from "./css/DirectMessageList.module.css";
import shell from "./css/SpaceChatShell.module.css";

export type ChatSidebarView = "channels" | "direct";

export interface FluxerSidebarProps {
  space: Space;
  conversations: SpaceConversation[];
  /** Messages in everyone the person hasn't read. */
  everyoneUnread: number;
  loading: boolean;
  currentUserId?: string;
  /** "everyone" or a conversation id. */
  selected: string;
  canWrite: boolean;
  /** Creating, renaming and deleting channels (`channels.manage`). */
  canManageChannels: boolean;
  onSelect(selection: string): void;
  onEdit(conversation: SpaceConversation): void;
  onDelete(conversation: SpaceConversation): void;
  onDeleteMany(ids: string[]): void;
  selectedIds: string[];
  onRangeSelect(event: MouseEvent, id: string, onOpen: () => void): void;
  onClearSelection(): void;
  onNewConversation(): void;
  onNewDirectMessage(): void;
}

/**
 * The channel column, as Fluxer draws a guild's: its channels (or the person's direct messages,
 * Misty's Channels | Direct switch). The chat page's bar names the Space, as on every Space page,
 * so Fluxer's guild header is left out; Misty's own sidebar already shows the person, so its user
 * area is too.
 */
export function FluxerSidebar(props: FluxerSidebarProps) {
  const stored = useChatSidebarPreferences((state) => state.value);
  const save = useChatSidebarPreferences((state) => state.set);
  const [channels, directMessages] = groupConversations(props.conversations);
  const openIsDirect = directMessages.conversations.some((item) => item.id === props.selected);
  const view: ChatSidebarView = (stored.direct ?? openIsDirect) ? "direct" : "channels";
  const setView = (next: ChatSidebarView) =>
    save((current) => ({ ...current, direct: next === "direct" }));
  const [dialog, setDialog] = useState<SpaceDialog>(null);
  const [collapsed, setCollapsed] = useState(false);
  const canInvite = spaceCan(props.space, "space.invite");
  return (
    <nav aria-label={`Channels in ${props.space.name}`} className={navbar.guildNavbarContainer}>
      <SpaceDialogs space={props.space} open={dialog} onClose={() => setDialog(null)} />
      <div className={list.channelListScrollerWrapper}>
        <FluxerScroller className={list.channelListScroller}>
          <div className={list.navigationContainer} role="navigation">
            <div className={list.topDropZone} />
            <div className={shell.viewTabs} role="tablist" aria-label="Show">
              {(["channels", "direct"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={view === value}
                  className={cx(shell.viewTab, view === value && shell.viewTabActive)}
                  onClick={() => setView(value)}
                >
                  {value === "channels" ? "Channels" : "Direct messages"}
                </button>
              ))}
            </div>
            {props.selectedIds.length ? (
              <div className={shell.selectionBar}>
                <span style={{ flex: 1 }}>{`${props.selectedIds.length} selected`}</span>
                <button
                  type="button"
                  className={cx(shell.selectionAction, shell.selectionActionDanger)}
                  onClick={() => props.onDeleteMany(props.selectedIds)}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className={shell.selectionAction}
                  onClick={props.onClearSelection}
                >
                  Clear
                </button>
              </div>
            ) : null}
            {view === "channels" ? (
              <div className={list.channelGroupsContainer} data-tour="space-chat-channels">
                <div className={list.channelGroup}>
                  <CategoryRow
                    name="Channels"
                    collapsed={collapsed}
                    onToggle={() => setCollapsed((current) => !current)}
                    onCreate={props.canManageChannels ? props.onNewConversation : undefined}
                  />
                  <ChannelRow
                    name="everyone"
                    locked={false}
                    selected={props.selected === "everyone"}
                    unread={props.selected !== "everyone" && props.everyoneUnread > 0}
                    hidden={collapsed}
                    onOpen={() => props.onSelect("everyone")}
                    onInvite={canInvite ? () => setDialog("invite") : undefined}
                  />
                  {channels.conversations.map((conversation) => {
                    const id = conversation.id;
                    const name = conversationName(conversation, props.currentUserId);
                    const manage = props.canManageChannels;
                    return (
                      <ChannelRow
                        key={id}
                        name={name}
                        locked={isPrivateChannel(conversation)}
                        selected={props.selected === id}
                        picked={props.selectedIds.includes(id)}
                        unread={props.selected !== id && (conversation.unread_count ?? 0) > 0}
                        hidden={collapsed && props.selected !== id}
                        onOpen={(event) => {
                          if (manage) props.onRangeSelect(event, id, () => props.onSelect(id));
                          else props.onSelect(id);
                        }}
                        onInvite={canInvite ? () => setDialog("invite") : undefined}
                        onEdit={manage ? () => props.onEdit(conversation) : undefined}
                        onDelete={manage ? () => props.onDelete(conversation) : undefined}
                      />
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className={dm.scrollerContent} data-tour="space-chat-dms">
                <div className={dm.dmSectionHeader}>
                  <span className={dm.dmSectionHeaderLabel}>
                    <span className={dm.dmSectionHeaderText}>Direct messages</span>
                  </span>
                  {props.canWrite ? (
                    <FluxerTooltip content="Create DM">
                      <button
                        type="button"
                        className={dm.dmCreateButton}
                        aria-label="New direct message"
                        onClick={props.onNewDirectMessage}
                      >
                        <Plus className={dm.iconSize} />
                      </button>
                    </FluxerTooltip>
                  ) : null}
                </div>
                {directMessages.conversations.map((conversation) => {
                  const other = conversation.participants.find(
                    (person) => person.kind === "person" && person.user_id !== props.currentUserId,
                  );
                  const selected = props.selected === conversation.id;
                  const unread = !selected && (conversation.unread_count ?? 0) > 0;
                  return (
                    <div
                      key={conversation.id}
                      role="link"
                      tabIndex={0}
                      aria-current={selected ? "page" : undefined}
                      className={cx(
                        dm.dmItem,
                        selected && dm.dmItemSelected,
                        unread && dm.dmItemUnread,
                      )}
                      onClick={() => props.onSelect(conversation.id)}
                      onKeyDown={(event) => activate(event, () => props.onSelect(conversation.id))}
                    >
                      {unread ? (
                        <div className={dm.dmItemUnreadIndicatorContainerDesktop}>
                          <span className={dm.dmItemUnreadIndicator} style={{ height: 8 }} />
                        </div>
                      ) : null}
                      <div className={dm.dmItemContent}>
                        <div className={dm.dmItemAvatarWrapper}>
                          <FluxerAvatar
                            id={other?.user_id ?? conversation.id}
                            name={conversationName(conversation, props.currentUserId)}
                            size={32}
                          />
                        </div>
                        <div className={dm.dmItemInfo}>
                          <span className={dm.dmItemName}>
                            <span className={dm.dmItemNameText}>
                              {conversationName(conversation, props.currentUserId)}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className={list.bottomSpacer} />
          </div>
        </FluxerScroller>
      </div>
    </nav>
  );
}

function activate(event: KeyboardEvent, run: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  run();
}

/** GuildHeaderPopout's item: the label, its icon on the right; hovering moves focus to it. */
export function PopoutItem(props: {
  label: string;
  icon: LucideIcon;
  danger?: boolean;
  onSelect(): void;
}) {
  const Glyph = props.icon;
  return (
    <button
      type="button"
      className={cx(popout.itemButton, props.danger && popout.itemDanger)}
      onMouseEnter={(event) => event.currentTarget.focus()}
      onClick={props.onSelect}
    >
      <span className={popout.itemTitle}>{props.label}</span>
      <Glyph className={popout.iconMedium} />
    </button>
  );
}

/** A category's row: its name, + and the chevron at the far right. */
function CategoryRow(props: {
  name: string;
  collapsed: boolean;
  onToggle(): void;
  onCreate?: () => void;
}) {
  return (
    <div
      className={cx(item.container, item.channelReorderTarget, item.channelCategoryReorderTarget)}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!props.collapsed}
        className={cx(item.channelItem, surface.channelItemSurface, item.channelItemCategory)}
        onClick={props.onToggle}
        onKeyDown={(event) => activate(event, props.onToggle)}
      >
        <div className={item.categoryContent}>
          <span className={item.categoryName}>{props.name}</span>
        </div>
        <div className={item.channelItemActions}>
          {props.onCreate ? (
            <div className={item.hoverAffordance}>
              <FluxerTooltip content="Create channel">
                <button
                  type="button"
                  aria-label="Create channel"
                  className={item.createChannelButton}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onCreate?.();
                  }}
                >
                  <Plus className={item.createChannelIcon} />
                </button>
              </FluxerTooltip>
            </div>
          ) : null}
          <ChevronDown
            className={item.categoryIcon}
            style={{ transform: `rotate(${props.collapsed ? -90 : 0}deg)` }}
          />
        </div>
      </div>
    </div>
  );
}

/** One channel: the unread pill, its # glyph and name, and the hover-only invite and gear. */
function ChannelRow(props: {
  name: string;
  locked: boolean;
  selected: boolean;
  unread: boolean;
  picked?: boolean;
  hidden?: boolean;
  onOpen(event: MouseEvent): void;
  onInvite?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  if (props.hidden) return null;
  const Glyph = props.locked ? Lock : Hash;
  const iconClass = props.selected
    ? item.channelItemIconSelected
    : props.unread
      ? item.channelItemIconHighlight
      : item.channelItemIconUnselected;
  const row = (
    <div
      role="button"
      tabIndex={0}
      aria-current={props.selected ? "page" : undefined}
      aria-label={`${props.name}${props.unread ? ", unread" : ""}`}
      className={cx(
        item.channelItem,
        surface.channelItemSurface,
        props.selected && surface.channelItemSurfaceSelected,
        item.channelItemRegular,
        props.unread ? item.channelItemHighlight : item.channelItemMuted,
        props.selected && item.channelItemSelected,
        !props.selected && item.channelItemHoverable,
        menu && item.channelItemContextMenu,
        props.picked && shell.channelPicked,
      )}
      onClick={props.onOpen}
      onKeyDown={(event) => activate(event, () => props.onOpen(event as unknown as MouseEvent))}
    >
      <FluxerTooltip content={props.name}>
        <div>
          <Glyph className={cx(item.channelItemIcon, iconClass)} />
        </div>
      </FluxerTooltip>
      <span className={item.channelName}>{props.name}</span>
      <div className={item.channelItemActions}>
        {props.onInvite ? (
          <RowIcon
            label="Invite people"
            icon={UserPlus}
            selected={props.selected}
            onClick={props.onInvite}
          />
        ) : null}
        {props.onEdit ? (
          <RowIcon
            label="Edit channel"
            icon={Settings}
            selected={props.selected}
            onClick={props.onEdit}
          />
        ) : null}
      </div>
    </div>
  );
  return (
    <div className={cx(item.container, item.channelReorderTarget)}>
      {props.unread ? <div className={item.unreadIndicator} /> : null}
      {props.onEdit || props.onDelete ? (
        <Popover.Root open={menu} onOpenChange={setMenu}>
          <Popover.Anchor asChild>
            <div
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu(true);
              }}
            >
              {row}
            </div>
          </Popover.Anchor>
          <Popover.Portal>
            <Popover.Content
              side="right"
              align="start"
              sideOffset={8}
              collisionPadding={8}
              aria-label={`${props.name} actions`}
              className={cx("fluxer-chat", popout.container, shell.popoutMotion)}
              style={{ zIndex: 50 }}
            >
              {props.onEdit ? (
                <PopoutItem
                  label="Edit channel"
                  icon={Settings}
                  onSelect={() => {
                    setMenu(false);
                    props.onEdit?.();
                  }}
                />
              ) : null}
              {props.onDelete ? (
                <PopoutItem
                  label="Delete channel"
                  icon={Trash2}
                  danger
                  onSelect={() => {
                    setMenu(false);
                    props.onDelete?.();
                  }}
                />
              ) : null}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : (
        row
      )}
    </div>
  );
}

/** ChannelItemIcon: a 16px glyph on the row that only changes color, with its tooltip. */
function RowIcon(props: { label: string; icon: LucideIcon; selected: boolean; onClick(): void }) {
  const Glyph = props.icon;
  return (
    <div className={item.hoverAffordance}>
      <FluxerTooltip content={props.label}>
        <button
          type="button"
          tabIndex={-1}
          aria-label={props.label}
          className={cx(
            itemIcon.iconButton,
            props.selected ? itemIcon.iconButtonSelected : itemIcon.iconButtonDefault,
          )}
          onClick={(event) => {
            event.stopPropagation();
            props.onClick();
          }}
        >
          <Glyph className={itemIcon.icon} />
        </button>
      </FluxerTooltip>
    </div>
  );
}
