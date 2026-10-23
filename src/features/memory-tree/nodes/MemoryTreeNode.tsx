import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { ChevronRight, Copy, ExternalLink, Plus, Trash2 } from "lucide-react";
import { useRef } from "react";
import { useWorkspaceStore } from "@/features/workspace";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  cn,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Pressable,
} from "@/shared/ui";
import { formatWhen, nodeSubtitle } from "../format";
import { NODE_H, NODE_W } from "../layout";
import { MemoryPopover } from "../MemoryPopover";
import { addForms } from "../addForms";
import { isLeaf } from "../model";
import { useMemoryTreeStore } from "../useMemoryTreeStore";
import { type VisibleNode } from "../visibleTree";
import { NodeGlyph } from "./NodeGlyph";

export type MemoryFlowNode = Node<{ item: VisibleNode; spaceName: string }, "memory">;

const handleClass = "!size-px !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0";

/** One card of the tree. A memory opens a popover beside it; a right-click offers its actions. */
export function MemoryTreeNode({ data }: NodeProps<MemoryFlowNode>) {
  const { item, spaceName } = data;
  const { node } = item;
  const card = useRef<HTMLButtonElement>(null);
  const selected = useMemoryTreeStore((s) => s.selectedId === item.id);
  const open = useMemoryTreeStore((s) => s.expanded.has(item.id));
  const matching = useMemoryTreeStore((s) => s.matchIds.has(item.id));
  const searching = useMemoryTreeStore((s) => s.matchIds.size > 0);
  const toggle = useMemoryTreeStore((s) => s.toggleExpanded);
  const select = useMemoryTreeStore((s) => s.select);
  const askForget = useMemoryTreeStore((s) => s.askForget);
  const askAdd = useMemoryTreeStore((s) => s.askAdd);
  const expandable = Boolean(node?.expandable);
  const leaf = node !== null && isLeaf(node);
  const label = node ? node.label : spaceName;
  const subtitle = node ? nodeSubtitle(node) : "Everything Misty remembers here";

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className={handleClass}
        isConnectable={false}
      />
      <ContextMenu>
        <Popover open={selected && leaf} onOpenChange={(next) => !next && select(null)}>
          <ContextMenuTrigger asChild>
            <PopoverAnchor asChild>
              <Pressable
                ref={card}
                onClick={() => {
                  if (leaf) select(selected ? null : item.id);
                  else {
                    select(node ? item.id : null);
                    if (expandable) toggle(item.id);
                  }
                }}
                aria-expanded={expandable ? open : undefined}
                aria-pressed={selected}
                style={{ width: NODE_W, height: NODE_H }}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border border-charcoal-border-strong bg-charcoal-card px-3",
                  "transition-[background-color,opacity,border-color,box-shadow] duration-200 hover:bg-charcoal-hover",
                  selected && "border-cream-bright shadow-[0_0_0_3px_rgb(241_241_241/0.08)]",
                  searching && !matching && node?.type === "moment" && "opacity-40",
                  matching && "border-cream-muted",
                )}
              >
                <NodeGlyph node={node} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-cream-bright">
                    {label}
                  </span>
                  <span className="block truncate text-[11px] text-cream-muted">{subtitle}</span>
                </span>
                {leaf && (
                  <span className="shrink-0 text-[11px] tabular-nums text-cream-muted">
                    {formatWhen(node.last_at)}
                  </span>
                )}
                {expandable && (
                  <ChevronRight
                    className={cn(
                      "size-4 shrink-0 text-cream-muted transition-transform",
                      open && "rotate-90",
                    )}
                    aria-hidden="true"
                  />
                )}
              </Pressable>
            </PopoverAnchor>
          </ContextMenuTrigger>
          {leaf && (
            <PopoverContent
              side="right"
              align="start"
              sideOffset={14}
              className="w-72 p-3"
              onOpenAutoFocus={(event) => event.preventDefault()}
              // A press on the card itself toggles it; the card's click handler decides.
              onInteractOutside={(event) => {
                if (event.target instanceof HTMLElement && card.current?.contains(event.target))
                  event.preventDefault();
              }}
            >
              <MemoryPopover node={node} />
            </PopoverContent>
          )}
        </Popover>
        {node && (
          <ContextMenuContent className="w-44">
            {node.type === "branch" && (
              <ContextMenuItem onSelect={() => askAdd(node.branch)}>
                <Plus aria-hidden="true" />
                {addForms[node.branch].menu}…
              </ContextMenuItem>
            )}
            {node.url && (
              <ContextMenuItem
                onSelect={() => useWorkspaceStore.getState().openBrowserView({ url: node.url! })}
              >
                <ExternalLink aria-hidden="true" />
                Open page
              </ContextMenuItem>
            )}
            {leaf && (node.text || node.preview) && (
              <ContextMenuItem
                onSelect={() => void navigator.clipboard.writeText(node.text || node.preview || "")}
              >
                <Copy aria-hidden="true" />
                Copy text
              </ContextMenuItem>
            )}
            <ContextMenuItem onSelect={() => askForget({ id: node.id, label: node.label })}>
              <Trash2 aria-hidden="true" />
              Forget…
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>
      <Handle
        type="source"
        position={Position.Right}
        className={handleClass}
        isConnectable={false}
      />
    </>
  );
}
