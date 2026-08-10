import { useEffect, useState, type ReactNode } from "react";
import {
  FileText,
  Hash,
  Image,
  ListTodo,
  PencilRuler,
  UserRound,
  MessagesSquare,
} from "lucide-react";
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui";
import type { Conversation, ItemKind } from "./model";

export const itemIcons = {
  chat: MessagesSquare,
  task: ListTodo,
  note: FileText,
  drawing: PencilRuler,
  file: Image,
};
export const areaLabels: Record<ItemKind, string> = {
  chat: "Chat",
  task: "Planner",
  note: "Journal",
  drawing: "Journal",
  file: "Library",
};
export function ConversationIcon({ conversation }: { conversation: Conversation }) {
  const Icon =
    conversation.group === "Direct messages"
      ? UserRound
      : conversation.group === "Connected"
        ? MessagesSquare
        : Hash;
  return <Icon size={18} aria-hidden="true" />;
}
export function useNarrow() {
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 700px)").matches);
  useEffect(() => {
    const media = matchMedia("(max-width: 700px)");
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return narrow;
}
const emojis = [
  ["👍", "thumbs up"],
  ["❤️", "heart"],
  ["🙌", "raised hands"],
  ["😂", "laughing"],
  ["🎉", "celebration"],
  ["✅", "check"],
  ["👀", "eyes"],
  ["☕", "coffee"],
  ["📚", "books"],
  ["😊", "smile"],
  ["🙏", "thanks"],
  ["💡", "idea"],
];
export function EmojiPicker({
  children,
  onSelect,
}: {
  children: ReactNode;
  onSelect: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end" side="top">
        <Input
          aria-label="Find an emoji"
          placeholder="Find an emoji"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="mt-3 grid grid-cols-4 gap-1">
          {emojis
            .filter(([emoji, name]) => (emoji + name).includes(query.toLowerCase()))
            .map(([emoji, name]) => (
              <Button
                key={name}
                variant="ghost"
                size="icon"
                className="text-xl"
                aria-label={name}
                onClick={() => {
                  onSelect(emoji);
                  setOpen(false);
                  setQuery("");
                }}
              >
                {emoji}
              </Button>
            ))}
        </div>
        {emojis.every(([emoji, name]) => !(emoji + name).includes(query.toLowerCase())) && (
          <p className="mt-3 text-sm text-cream-muted">No matching emoji.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
