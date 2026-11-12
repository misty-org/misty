import { Hash, User, Users } from "lucide-react";
import { useState } from "react";
import type { SpaceConversation } from "../api/dto/entities";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  MenuTrigger,
  Popover,
  PopoverContent,
} from "@/shared/ui";
import { conversationName } from "./sidebar/conversationGroups";

/**
 * The chat panel's one header control: names the open chat and switches it. The panel has no
 * sidebar, so Everyone and every channel or conversation live here, searchable.
 */
export function ChatPanelPicker(props: {
  conversations: SpaceConversation[];
  currentUserId?: string;
  /** "" is the Space-wide Everyone chat. */
  selected: string;
  onSelect(conversationId: string): void;
}) {
  const [open, setOpen] = useState(false);
  const current = props.conversations.find((item) => item.id === props.selected);
  const title = current ? conversationName(current, props.currentUserId) : "Everyone";
  const rows = [
    { id: "", name: "Everyone", icon: Users },
    ...[...props.conversations]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((item) => ({
        id: item.id,
        name: conversationName(item, props.currentUserId),
        icon: item.kind === "dm" ? User : Hash,
      })),
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <MenuTrigger
        kind="popover"
        label="Chats"
        value={title}
        className="min-w-0 max-w-64 font-medium"
      />
      <PopoverContent align="start" className="w-72 p-0" aria-label="Chats">
        <Command label="Chats">
          <CommandInput aria-label="Search chats" placeholder="Search chats" />
          <CommandList>
            <CommandEmpty>No chats match.</CommandEmpty>
            <CommandGroup>
              {rows.map((row) => (
                <CommandItem
                  key={row.id || "everyone"}
                  value={`${row.id}:${row.name}`}
                  icon={row.icon}
                  label={row.name}
                  checked={row.id === props.selected}
                  onSelect={() => {
                    setOpen(false);
                    props.onSelect(row.id);
                  }}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
