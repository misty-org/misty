import { spacesApi } from "@/api/spaces/api";
import type {
  SpaceRoadmap,
  SpaceRoadmapSnapshot,
} from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import { useAuth } from "@/features/auth";
import { errorText } from "@/shared/lib/format";
import { useLocalPinnedIds } from "@/shared/hooks/useLocalPinnedIds";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  EmptyState,
  Input,
  Skeleton,
  cn,
} from "@/shared/ui";
import { ArrowRight, Pin, PinOff, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { normalizeRoadmapSnapshot } from "./RoadmapWorkspaceHelpers";
import { RoadmapSnapshotPreview } from "./RoadmapSnapshotPreview";

export function RoadmapHome(props: {
  spaceId: string;
  roadmaps: SpaceRoadmap[];
  canManage: boolean;
  loading: boolean;
  error: string;
  onCreate: () => void;
  onOpen: (roadmapId: string) => void;
  onRetry: () => void;
}) {
  const { user } = useAuth();
  const { spaceId } = props;
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [preview, setPreview] = useState<SpaceRoadmapSnapshot>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const visibleRoadmaps = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return props.roadmaps;
    return props.roadmaps.filter((roadmap) =>
      `${roadmap.name} ${roadmap.description}`.toLowerCase().includes(term),
    );
  }, [props.roadmaps, query]);
  const orderedRoadmaps = useMemo(
    () =>
      [...props.roadmaps].sort(
        (left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at),
      ),
    [props.roadmaps],
  );
  const roadmapPinsKey = `misty:roadmap-pins:${user?.id ?? "anonymous"}:${spaceId}`;
  const availableRoadmapIds = useMemo(
    () => orderedRoadmaps.map((roadmap) => roadmap.id),
    [orderedRoadmaps],
  );
  const { pinnedIdSet, togglePinned } = useLocalPinnedIds(
    roadmapPinsKey,
    availableRoadmapIds,
    props.loading,
  );
  const pinnedRoadmaps = orderedRoadmaps.filter((roadmap) => pinnedIdSet.has(roadmap.id));
  const recentRoadmaps = orderedRoadmaps.filter((roadmap) => !pinnedIdSet.has(roadmap.id));
  const selectedRoadmap =
    visibleRoadmaps.find((roadmap) => roadmap.id === selectedId) ?? visibleRoadmaps[0];
  const selectedRoadmapId = selectedRoadmap?.id;

  useEffect(() => {
    if (!selectedRoadmapId) {
      setPreview(undefined);
      return;
    }
    let active = true;
    setPreview(undefined);
    setPreviewLoading(true);
    setPreviewError("");
    void spacesApi
      .roadmap(spaceId, selectedRoadmapId)
      .then((snapshot) => normalizeRoadmapSnapshot(snapshot))
      .then((snapshot) => {
        if (active) setPreview(snapshot);
      })
      .catch((reason) => {
        if (active) setPreviewError(errorText(reason));
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedRoadmapId, spaceId]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-charcoal-bg text-cream">
      <div className="grid min-h-0 flex-1 gap-5 p-5 md:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col">
          <div className="mb-2 flex h-8 shrink-0 items-center gap-2">
            <h1 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-cream-bright">
              My Roadmaps
            </h1>
            {props.canManage ? (
              <Button
                className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
                type="button"
                disabled={props.loading}
                onClick={props.onCreate}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                New
              </Button>
            ) : null}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-charcoal-border bg-charcoal-card">
            <div className="shrink-0 border-b border-charcoal-border p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-cream-muted" />
                <Input
                  className="h-8 bg-charcoal-bg pl-8 text-xs"
                  aria-label="Search roadmaps"
                  placeholder="Search roadmaps"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </div>
            <div className="misty-scrollbar min-h-0 flex-1 overflow-y-auto">
              {props.loading && !props.roadmaps.length ? (
                <RoadmapListSkeleton />
              ) : visibleRoadmaps.length ? (
                query.trim() ? (
                  <RoadmapRows
                    roadmaps={visibleRoadmaps}
                    selectedId={selectedRoadmap?.id}
                    pinnedIds={pinnedIdSet}
                    onSelect={setSelectedId}
                    onTogglePin={togglePinned}
                  />
                ) : (
                  <div className="pb-2">
                    <RoadmapSection
                      title="Pinned"
                      roadmaps={pinnedRoadmaps}
                      emptyLabel="Pin a roadmap from its menu for quick access."
                      selectedId={selectedRoadmap?.id}
                      pinnedIds={pinnedIdSet}
                      onSelect={setSelectedId}
                      onTogglePin={togglePinned}
                    />
                    <RoadmapSection
                      title="Recently edited"
                      roadmaps={recentRoadmaps}
                      emptyLabel="Your pinned roadmaps are shown above."
                      selectedId={selectedRoadmap?.id}
                      pinnedIds={pinnedIdSet}
                      onSelect={setSelectedId}
                      onTogglePin={togglePinned}
                    />
                  </div>
                )
              ) : (
                <EmptyState
                  className="h-full min-h-52"
                  title={query ? "No matching roadmaps" : "Plan an outcome"}
                  description={
                    query
                      ? `Nothing matches “${query}”.`
                      : "Create a roadmap to arrange milestones, goals, and the work between them."
                  }
                  action={
                    query ? (
                      <Button variant="secondary" onClick={() => setQuery("")}>
                        Clear search
                      </Button>
                    ) : props.canManage ? (
                      <Button disabled={props.loading} onClick={props.onCreate}>
                        {props.loading ? "Creating…" : "Create roadmap"}
                      </Button>
                    ) : undefined
                  }
                />
              )}
            </div>
          </div>
          {props.error ? (
            <div className="mt-2 flex items-center gap-2 text-xs text-cream-muted">
              <span className="min-w-0 flex-1 truncate">{props.error}</span>
              <Button variant="ghost" size="sm" className="h-7" onClick={props.onRetry}>
                Retry
              </Button>
            </div>
          ) : null}
        </section>

        <section className="flex min-h-0 flex-col">
          <div className="mb-2 flex h-8 shrink-0 items-center gap-2">
            <h2 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-cream-bright">
              {selectedRoadmap?.name ?? "Roadmap preview"}
            </h2>
            {selectedRoadmap ? (
              <Button
                type="button"
                size="sm"
                className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
                aria-label={`Open ${selectedRoadmap.name}`}
                onClick={() => props.onOpen(selectedRoadmap.id)}
              >
                Open roadmap
                <ArrowRight data-icon="inline-end" className="size-3.5" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-charcoal-border bg-charcoal-card">
            {previewLoading ? (
              <RoadmapPreviewSkeleton />
            ) : previewError ? (
              <EmptyState
                className="h-full"
                title="Roadmap preview unavailable"
                description={previewError}
                action={
                  selectedRoadmap ? (
                    <Button onClick={() => props.onOpen(selectedRoadmap.id)}>
                      Open roadmap
                      <ArrowRight data-icon="inline-end" aria-hidden="true" />
                    </Button>
                  ) : undefined
                }
              />
            ) : preview && preview.roadmap.id === selectedRoadmap?.id ? (
              <RoadmapSnapshotPreview snapshot={preview} />
            ) : (
              <EmptyState
                className="h-full"
                title="No roadmap selected"
                description="Choose a roadmap from the list to preview its structure."
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

type RoadmapRowsProps = {
  roadmaps: SpaceRoadmap[];
  selectedId?: string;
  pinnedIds: Set<string>;
  onSelect: (roadmapId: string) => void;
  onTogglePin: (roadmapId: string) => void;
};

function RoadmapSection(props: RoadmapRowsProps & { title: string; emptyLabel: string }) {
  return (
    <section aria-label={props.title}>
      <h2 className="m-0 px-3.5 pb-1.5 pt-3 text-xs font-semibold text-cream-muted">
        {props.title}
      </h2>
      {props.roadmaps.length ? (
        <RoadmapRows {...props} />
      ) : (
        <p className="px-3.5 py-2 text-[11px] leading-4 text-cream-muted/75">{props.emptyLabel}</p>
      )}
    </section>
  );
}

function RoadmapRows(props: RoadmapRowsProps) {
  return props.roadmaps.map((roadmap) => {
    const selected = roadmap.id === props.selectedId;
    const pinned = props.pinnedIds.has(roadmap.id);
    return (
      <ContextMenu key={roadmap.id}>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "group/roadmap flex min-h-12 items-center transition-colors",
              selected
                ? "bg-charcoal-hover hover:bg-charcoal-hover"
                : "hover:bg-charcoal-border/65",
            )}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 self-stretch items-center gap-2 px-3.5 py-2 text-left outline-none"
              aria-current={selected ? "true" : undefined}
              onClick={() => props.onSelect(roadmap.id)}
            >
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[13px] font-medium text-cream-bright">
                  {roadmap.name}
                </strong>
                <span className="mt-0.5 block truncate text-[11px] text-cream-muted">
                  {roadmap.description || formatRoadmapDate(roadmap.updated_at)}
                </span>
              </span>
              {pinned ? (
                <Pin className="size-3 shrink-0 text-cream-muted" aria-hidden="true" />
              ) : null}
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-40">
          <ContextMenuItem onSelect={() => props.onTogglePin(roadmap.id)}>
            {pinned ? <PinOff /> : <Pin />}
            {pinned ? "Unpin" : "Pin"}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  });
}

function RoadmapListSkeleton() {
  return (
    <div className="space-y-px">
      {Array.from({ length: 4 }, (_, index) => (
        <div className="px-3 py-3" key={index}>
          <Skeleton className="h-3.5 w-3/5" />
          <Skeleton className="mt-2 h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

function RoadmapPreviewSkeleton() {
  return (
    <div className="p-5">
      <Skeleton className="h-5 w-56" />
      <Skeleton className="mt-3 h-3 w-4/5" />
      <Skeleton className="mt-6 h-24 w-full rounded-xl" />
      <Skeleton className="mt-3 h-32 w-full rounded-xl" />
    </div>
  );
}

function formatRoadmapDate(value?: string) {
  if (!value) return "Recently updated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently updated";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
