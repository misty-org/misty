import { MoreHorizontal, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Input,
  SegmentedControl,
} from "@/shared/ui";
import { MemoryFilterMenu } from "./MemoryFilterMenu";
import { addForms, addOrder } from "./addForms";
import { type MemoryRange } from "./model";
import { useMemoryTreeStore } from "./useMemoryTreeStore";

const ranges = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "all", label: "All" },
] as const;

/** Search by meaning, the time window, filters and refresh: no title, the page is the tree. */
export function MemoryTreeToolbar({ spaceName }: { spaceName: string }) {
  const range = useMemoryTreeStore((s) => s.range);
  const setRange = useMemoryTreeStore((s) => s.setRange);
  const refresh = useMemoryTreeStore((s) => s.refresh);
  const search = useMemoryTreeStore((s) => s.search);
  const askForget = useMemoryTreeStore((s) => s.askForget);
  const askAdd = useMemoryTreeStore((s) => s.askAdd);
  const [text, setText] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => void search(text), 350);
    return () => window.clearTimeout(timer);
  }, [text, search]);

  return (
    <div className="flex items-center gap-2 border-b border-charcoal-border px-3 py-2">
      <div className="relative min-w-0 flex-1">
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
      <IconButton label="Refresh" onClick={() => void refresh()}>
        <RefreshCw />
      </IconButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="Add a memory">
            <Plus />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {addOrder.map((branch) => (
            <DropdownMenuItem key={branch} onSelect={() => askAdd(branch)}>
              {addForms[branch].menu}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="More">
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            onSelect={() => askForget({ id: "space", label: `everything in ${spaceName}` })}
          >
            <Trash2 aria-hidden="true" />
            Forget everything…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
