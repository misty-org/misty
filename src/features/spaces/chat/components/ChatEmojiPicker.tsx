import { useState, type ReactNode } from "react";
import { IconButton, Input, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui";

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
      <PopoverContent className="w-64 p-3" align="end" side="top">
        <Input
          aria-label="Find an emoji"
          placeholder="Find an emoji"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="mt-3 grid grid-cols-4 gap-1">
          {matches.map(([emoji, name]) => (
            <IconButton
              key={name}
              variant="ghost"
              size="md"
              className="text-xl"
              label={name}
              tooltip={false}
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
        {!matches.length && <p className="mt-3 text-sm text-cream-muted">No matching emoji.</p>}
      </PopoverContent>
    </Popover>
  );
}
