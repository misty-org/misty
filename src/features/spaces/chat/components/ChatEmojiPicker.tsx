import { useState, type ReactNode } from "react";
import {
  IconButton,
  PickerList,
  PickerSearch,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Text,
} from "@/shared/ui";

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
export function ChatEmojiPicker({
  children,
  onSelect,
}: {
  children: ReactNode;
  onSelect: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const matches = emojis.filter(([emoji, name]) =>
    (emoji + name).includes(query.trim().toLowerCase()),
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent size="sm" kind="flush" align="end" side="top">
        <PickerSearch
          autoFocus
          aria-label="Find an emoji"
          placeholder="Find an emoji"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <PickerList>
          <div className="grid grid-cols-4 gap-1">
            {matches.map(([emoji, name]) => (
              <IconButton
                key={name}
                className="text-xl"
                label={name}
                onClick={() => {
                  onSelect(emoji);
                  setOpen(false);
                  setQuery("");
                }}
              >
                {emoji}
              </IconButton>
            ))}
          </div>
          {!matches.length && (
            <Text as="p" size="meta" tone="muted" className="px-2 py-1.5">
              No matching emoji
            </Text>
          )}
        </PickerList>
      </PopoverContent>
    </Popover>
  );
}
