import type {
  AiCaptureAttachment,
  AiContextReference,
  AiSelectionSnapshot,
} from "@/features/ai-surface";
import { Button, cn, IconButton, SegmentedControl, Spinner } from "@/shared/ui";
import { Bot, Camera, Command, FileText, FolderOpen, MessageCircle, Search, X } from "lucide-react";
import type {
  GlobalAiContextRef,
  GlobalAiMode,
  GlobalSearchFilters,
  GlobalSearchResult,
  UnifiedMistyCandidate,
} from "./types";

type ExplorerContextPane = {
  listing?: {
    entries?: Array<{
      id: string;
      kind: "file" | "folder";
      name: string;
      path: string;
      location: { kind: string };
    }>;
  };
  selectedIds?: string[];
};

export function SearchAskToggle(props: {
  mode: GlobalAiMode;
  compact?: boolean;
  onChange: (mode: "search" | "ask") => void;
}) {
  return (
    <SegmentedControl
      label="Search or Ask"
      size={props.compact ? "xs" : "sm"}
      className={props.compact ? undefined : "mx-4 mb-3"}
      value={props.mode === "search" ? "search" : "ask"}
      options={[
        {
          value: "search",
          label: "Search",
          icon: <Search strokeWidth={1.9} />,
          attributes: { "data-misty-mode": "search" },
        },
        {
          value: "ask",
          label: "Ask",
          icon: <MessageCircle strokeWidth={1.9} />,
          attributes: { "data-misty-mode": "ask" },
        },
      ]}
      onChange={props.onChange}
    />
  );
}

export function CandidateList(props: {
  candidates: UnifiedMistyCandidate[];
  selectedId: string;
  searching: boolean;
  onSelect: (id: string) => void;
  onActivate: (candidate: UnifiedMistyCandidate) => void;
  onAddContext: (result: GlobalSearchResult) => void;
}) {
  return (
    <div className="p-2" role="listbox" aria-label="Misty candidates">
      {props.searching ? (
        <div className="flex h-7 items-center px-2 text-[11px] text-cream-muted">
          <Spinner size="sm" label={false} className="size-3 mr-1.5" /> Enriching results…
        </div>
      ) : null}
      {props.candidates.map((candidate) => {
        const Icon = candidateIcon(candidate);
        const result =
          candidate.type === "object" || candidate.type === "navigation" ? candidate.result : null;
        return (
          <div
            key={candidate.id}
            role="option"
            aria-selected={candidate.id === props.selectedId}
            className={cn(
              "group grid min-h-[58px] grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2",
              candidate.id === props.selectedId
                ? "bg-charcoal-hover"
                : "hover:bg-charcoal-hover/70",
            )}
            onMouseEnter={() => props.onSelect(candidate.id)}
          >
            <Button
              variant="ghost"
              className="contents text-left"
              onClick={() => props.onActivate(candidate)}
            >
              <span className="grid size-9 place-items-center rounded-lg bg-charcoal-bg text-cream-muted">
                <Icon className="size-4" strokeWidth={1.8} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-cream">
                  {candidate.title}
                </span>
                <span className="block truncate text-xs text-cream-muted">
                  {candidate.description}
                </span>
              </span>
            </Button>
            {result ? (
              <Button
                variant="ghost"
                className="px-2 py-1 text-[11px] text-cream-muted opacity-0 hover:text-cream group-hover:opacity-100 focus:opacity-100"
                onClick={() => props.onAddContext(result)}
              >
                + Context
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function candidateIcon(candidate: UnifiedMistyCandidate) {
  if (candidate.type === "answer") return MessageCircle;
  if (candidate.type === "agent_task") return Bot;
  if (candidate.type === "command") return Command;
  if (
    (candidate.type === "object" || candidate.type === "navigation") &&
    candidate.result.kind === "note"
  )
    return FileText;
  return FolderOpen;
}

export function ContextReceipt(props: {
  context: GlobalAiContextRef[];
  capture?: AiCaptureAttachment;
  selection?: AiSelectionSnapshot;
  onRemove: (id: string) => void;
  onRemoveCapture?: () => void;
}) {
  if (!props.context.length && !props.capture && !props.selection) return null;
  return (
    <div className="flex min-h-9 items-center gap-1.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
      <span className="mr-1 shrink-0 text-[11px] font-medium text-cream-muted">Context</span>
      {props.context.map((item) => (
        <span
          key={`${item.kind}:${item.id}`}
          className="flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-charcoal-border bg-charcoal-bg px-2 text-[11px] text-cream-muted"
        >
          {item.title}
          {item.localPath && !item.attached ? " · device only" : ""}
          <IconButton
            label={`Remove ${item.title} context`}
            onClick={() => props.onRemove(item.id)}
          >
            <X className="size-3" />
          </IconButton>
        </span>
      ))}
      {props.capture ? (
        <span className="flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-charcoal-border bg-charcoal-bg px-2 text-[11px] text-cream-muted">
          <Camera className="size-3" /> Region capture
          <IconButton label="Remove region capture" onClick={() => props.onRemoveCapture?.()}>
            <X className="size-3" />
          </IconButton>
        </span>
      ) : null}
      {props.selection ? (
        <span
          className={cn(
            "flex h-6 max-w-64 shrink-0 items-center gap-1.5 rounded-full border",
            "border-charcoal-border bg-charcoal-bg px-2 text-[11px] text-cream-muted",
          )}
        >
          <FileText className="size-3" />
          <span className="truncate">Selection: {props.selection.content}</span>
        </span>
      ) : null}
    </div>
  );
}

export function FilterBar(props: {
  mode: GlobalAiMode;
  filters: GlobalSearchFilters;
  currentContext: GlobalAiContextRef[];
  onChange: (filters: GlobalSearchFilters) => void;
}) {
  const currentSpaceId = props.currentContext.find((item) => item.spaceId)?.spaceId;
  const buttons = [
    {
      label: "Notes",
      active: props.filters.kinds.includes("note"),
      run: () =>
        props.onChange({
          ...props.filters,
          kinds: props.filters.kinds.includes("note") ? [] : ["note"],
        }),
    },
    ...(currentSpaceId
      ? [
          {
            label: "Current Space",
            active: props.filters.spaceId === currentSpaceId,
            run: () =>
              props.onChange({
                ...props.filters,
                spaceId: props.filters.spaceId ? undefined : currentSpaceId,
              }),
          },
        ]
      : []),
    {
      label: "Device",
      active: props.filters.source === "device",
      run: () =>
        props.onChange({
          ...props.filters,
          source: props.filters.source === "device" ? "all" : "device",
        }),
    },
    {
      label: "Cloud",
      active: props.filters.source === "cloud",
      run: () =>
        props.onChange({
          ...props.filters,
          source: props.filters.source === "cloud" ? "all" : "cloud",
        }),
    },
    ...(props.mode === "search"
      ? []
      : [
          {
            label: "Misty answers",
            active: props.filters.intent === "misty",
            run: () =>
              props.onChange({
                ...props.filters,
                intent: props.filters.intent === "misty" ? "all" : "misty",
              }),
          },
          {
            label: "Agents",
            active: props.filters.intent === "agent",
            run: () =>
              props.onChange({
                ...props.filters,
                intent: props.filters.intent === "agent" ? "all" : "agent",
              }),
          },
        ]),
  ];
  return (
    <div
      className="flex gap-1.5 overflow-x-auto px-4 pb-3 [scrollbar-width:none]"
      aria-label="Search filters"
    >
      {buttons.map((button) => (
        <Button
          variant="chip"
          size="xs"
          aria-pressed={button.active}
          key={button.label}
          onClick={button.run}
          className="shrink-0"
        >
          {button.label}
          {button.active ? " ×" : ""}
        </Button>
      ))}
    </div>
  );
}

export function removeLastFilter(
  filters: GlobalSearchFilters,
  setFilters: (filters: GlobalSearchFilters) => void,
) {
  if (filters.intent !== "all") return (setFilters({ ...filters, intent: "all" }), true);
  if (filters.source !== "all") return (setFilters({ ...filters, source: "all" }), true);
  if (filters.spaceId) return (setFilters({ ...filters, spaceId: undefined }), true);
  if (filters.kinds.length)
    return (setFilters({ ...filters, kinds: filters.kinds.slice(0, -1) }), true);
  return false;
}

export function contextForCurrentView(
  currentPath: string,
  activePanePath: string,
  pane?: ExplorerContextPane,
  registeredAiContext: AiContextReference[] = [],
): GlobalAiContextRef[] {
  const context: GlobalAiContextRef[] = [];
  const spaceMatch = currentPath.match(/^\/spaces\/([^/?]+)/);
  if (spaceMatch?.[1]) {
    const spaceId = decodeURIComponent(spaceMatch[1]);
    context.push({
      id: `route:${currentPath}`,
      kind: "route",
      title: "Current Space view",
      href: currentPath,
      source: "current",
      spaceId,
    });
  } else {
    context.push({
      id: `route:${currentPath}`,
      kind: "route",
      title: routeTitle(currentPath),
      href: currentPath,
      source: "current",
    });
  }
  if (currentPath.startsWith("/files") && activePanePath) {
    context.push({
      id: `folder:${activePanePath}`,
      kind: "folder",
      title: activePanePath.split(/[\\/]/).filter(Boolean).pop() || "Current folder",
      source: "current",
      localPath: activePanePath,
    });
    const entries = pane?.listing?.entries ?? [];
    const selected = new Set(pane?.selectedIds ?? []);
    for (const entry of entries.filter((item) => selected.has(item.id)).slice(0, 6)) {
      context.push({
        id: entry.id,
        kind: entry.kind,
        title: entry.name,
        source: "current",
        ...(entry.location.kind === "local" ? { localPath: entry.path } : {}),
      });
    }
  }
  for (const item of registeredAiContext) {
    context.push({
      id: item.id,
      kind: item.kind,
      title: item.title,
      href: item.href,
      source: "current",
      spaceId: item.spaceId,
      attached: item.attached,
      privacy: item.privacy,
      revision: item.revision,
    });
  }
  return context;
}

function routeTitle(path: string) {
  if (path.startsWith("/files")) return "Files";
  if (path.startsWith("/agents")) return "Agents";
  if (path.startsWith("/discover") || path.startsWith("/store") || path.startsWith("/marketplace"))
    return "Discover";
  return "Current view";
}
