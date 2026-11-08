import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Input, SegmentedControl } from "@/shared/ui";
import { MemoryFilterMenu } from "./MemoryFilterMenu";
import { type MemoryRange } from "./memoryNodes";
import { useMemoryTreeStore } from "./useMemoryTreeStore";

const ranges = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "all", label: "All" },
] as const;

/** Search by meaning, the time window and filters. */
export function MemoryTreeToolbar() {
  const range = useMemoryTreeStore((s) => s.range);
  const setRange = useMemoryTreeStore((s) => s.setRange);
  const search = useMemoryTreeStore((s) => s.search);
  const query = useMemoryTreeStore((s) => s.query);
  const [text, setText] = useState("");

  // A thread picked in the recap searches the tree, and the box says so.
  useEffect(() => {
    setText((current) => (current.trim() === query ? current : query));
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void search(text), 350);
    return () => window.clearTimeout(timer);
  }, [text, search]);

  return (
    <div className="flex items-center gap-2 border-b border-charcoal-border px-3 py-2">
      <div className="relative w-full max-w-sm min-w-0">
        <Search
          className="pointer-events-none absolute inset-y-0 left-2.5 my-auto size-3.5 text-cream-muted"
          aria-hidden="true"
        />
        <Input
          variant="toolbar"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Search what Misty remembers"
          aria-label="Search memories"
          className="pl-8"
        />
      </div>
      <SegmentedControl<MemoryRange>
        label="Time window"
        value={range}
        options={ranges}
        onChange={(next) => void setRange(next)}
      />
      <MemoryFilterMenu />
    </div>
  );
}
