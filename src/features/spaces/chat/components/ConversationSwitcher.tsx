import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  ChevronDown,
  Hash,
  MessagesSquare,
  MoreHorizontal,
  Plus,
  Star,
  UserRound,
  Users,
} from "lucide-react";
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui";
import type { SpaceConversation, SpaceMember } from "@/api/spaces/dto/interfaces/types";
import { useSpaceConversations } from "../sidebar/useSpaceConversations";
import { conversationName, groupConversations } from "../sidebar/conversationGroups";
import { CreateEditConversationDialog } from "../sidebar/CreateEditConversationDialog";
import { socialConversationPath, socialProviderPath } from "../../social/socialRoute";
import { useSpacePersonalItems } from "../../useSpacePersonalItems";

export function ConversationSwitcher({
  spaceId,
  conversation,
  currentUserId,
  members,
  canWrite,
}: {
  spaceId: string;
  conversation?: SpaceConversation;
  currentUserId?: string;
  members: SpaceMember[];
  canWrite: boolean;
}) {
  const navigate = useNavigate();
  const data = useSpaceConversations(spaceId, true);
  const personal = useSpacePersonalItems(spaceId);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const itemKey = `chat:${conversation?.id || "everyone"}`;
  const starred = personal.items.some((i) => i.item_key === itemKey && i.favorite);
  const choose = (path: string) => {
    setOpen(false);
    navigate(path);
  };
  const title = conversation ? conversationName(conversation, currentUserId) : "Everyone";
  const button = (
    <Button
      ref={trigger}
      variant="ghost"
      className="min-w-0 max-w-full justify-start"
      aria-label={`Switch conversation: ${title}`}
    >
      <span className="truncate">{title}</span>
      <ChevronDown className="shrink-0" />
    </Button>
  );
  const list = (
    <Command>
      <CommandInput
        ref={searchRef}
        placeholder="Find a chat in this Space…"
        aria-label="Find a chat"
      />
      <CommandList className="max-h-[min(65dvh,420px)]">
        <CommandEmpty>{data.loading ? "Loading chats…" : "No matching chats."}</CommandEmpty>
        {groupConversations(data.conversations)
          .filter((group) => group.everyone || group.conversations.length > 0)
          .map((group) => (
            <CommandGroup key={group.id} heading={group.title}>
              {group.everyone && (
                <CommandItem
                  value="Everyone"
                  onSelect={() => choose(socialProviderPath(spaceId, "misty"))}
                >
                  <Users />
                  Everyone{!conversation && <Check className="ml-auto" />}
                </CommandItem>
              )}
              {group.conversations.map((c) => {
                const Icon =
                  group.provider !== "misty"
                    ? MessagesSquare
                    : c.kind === "direct"
                      ? UserRound
                      : Hash;
                return (
                  <CommandItem
                    key={c.id}
                    value={`${conversationName(c, currentUserId)} ${group.title} ${c.id}`}
                    onSelect={() => choose(socialConversationPath(spaceId, group.provider, c.id))}
                  >
                    <Icon />
                    <span className="truncate">{conversationName(c, currentUserId)}</span>
                    {conversation?.id === c.id && <Check className="ml-auto" />}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        <CommandSeparator />
        <CommandGroup heading="Actions">
          {canWrite && (
            <CommandItem
              onSelect={() => {
                setOpen(false);
                setCreating(true);
              }}
            >
              <Plus />
              New chat
            </CommandItem>
          )}
          <CommandItem onSelect={() => choose(`/spaces/${encodeURIComponent(spaceId)}/social`)}>
            <MessagesSquare />
            Browse all chats
          </CommandItem>
        </CommandGroup>
        {data.error && (
          <div role="alert" className="p-3 text-sm">
            {data.error}
            <Button variant="ghost" onClick={data.retry}>
              Retry
            </Button>
          </div>
        )}
      </CommandList>
    </Command>
  );
  const restoreFocus = () => trigger.current?.focus();
  return (
    <>
      <h1 className="min-w-0 flex-1 text-sm">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{button}</PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[min(380px,calc(100vw-32px))] p-0"
            onCloseAutoFocus={restoreFocus}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              searchRef.current?.focus();
            }}
          >
            {list}
          </PopoverContent>
        </Popover>
      </h1>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="Conversation menu">
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={!personal.ready}
            onSelect={() => {
              void personal.update(itemKey, { favorite: !starred }).catch(() => {});
            }}
          >
            <Star />
            {starred ? "Remove from favorites" : "Add to favorites"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => choose(`/spaces/${encodeURIComponent(spaceId)}/social`)}
          >
            Browse all chats
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {personal.error && (
        <span role="alert" className="max-w-48 text-xs text-cream-muted">
          {personal.error}
        </span>
      )}
      <CreateEditConversationDialog
        spaceId={spaceId}
        open={creating}
        onOpenChange={setCreating}
        members={members}
        currentUserId={currentUserId}
        onSaved={(saved) => {
          data.upsert(saved);
          setCreating(false);
          choose(socialConversationPath(spaceId, "misty", saved.id));
        }}
      />
    </>
  );
}
