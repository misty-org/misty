import { useState } from "react";
import {
  ArrowDownAZ,
  CalendarPlus,
  Clock,
  EllipsisVertical,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { confirmAction } from "@/shared/lib/confirmAction";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import {
  Button,
  CollectionSortMenu,
  CollectionViewToggle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  MenuItem,
  Pressable,
  Skeleton,
  Surface,
  Text,
  ToolbarDivider,
  useNotice,
} from "@/shared/ui";
import { shortAgo } from "../page/useChatStatuses";
import { SearchAll } from "./SearchAll";
import { NotebookShareItems, SharedNotebooks } from "./SharedNotebooks";
import { TopicStart } from "./TopicStart";
import { TutorLessons } from "./TutorLessons";
import type { TutorActions } from "./TutorPage";
import { useTutorStore } from "./tutorStore";
import type { Notebook } from "./tutorTypes";
import { useNow } from "@/shared/hooks/useNow";

const sorts: readonly { value: "recent" | "title" | "created"; label: string; icon: LucideIcon }[] =
  [
    { value: "recent", label: "Most recent", icon: Clock },
    { value: "title", label: "Title", icon: ArrowDownAZ },
    { value: "created", label: "Date created", icon: CalendarPlus },
  ];
type Sort = (typeof sorts)[number]["value"];

/** How the notebooks are laid out and ordered, kept for this device in `misty.db`. */
const useHomeLayout = createDeviceSetting<{ view: "grid" | "list"; sort: Sort }>({
  scope: "tutor-home-layout",
  defaults: { view: "grid", sort: "recent" },
  normalize: (stored) => {
    const saved = stored as { view?: unknown; sort?: unknown } | null;
    return {
      view: saved?.view === "list" ? "list" : "grid",
      sort: sorts.find((option) => option.value === saved?.sort)?.value ?? "recent",
    };
  },
});

function ordered(notebooks: Notebook[], sort: Sort): Notebook[] {
  return [...notebooks].sort((a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title)
      : sort === "created"
        ? b.createdAt.localeCompare(a.createdAt)
        : b.updatedAt.localeCompare(a.updatedAt),
  );
}

/** A notebook as a card in the grid: its emoji at the top, its name and details at the foot. */
const cardClass = "relative flex min-h-47.5 flex-col gap-1.5 p-4.5 text-left";
/** A notebook as a row: emoji, title, sources, last opened, and room for its menu. */
const rowGrid = "grid grid-cols-[28px_minmax(0,1fr)_120px_140px_32px] items-center gap-3 px-2";
/** Each row stands on a hairline. */
const rowEdge = "border-0 border-b";

const sourcesLabel = (count: number) => `${count} ${count === 1 ? "source" : "sources"}`;
const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** A notebook's own menu, on its card or row. */
function NotebookMenu({
  notebook,
  className,
  onError,
}: {
  notebook: Notebook;
  className?: string;
  onError(message: string): void;
}) {
  const remove = async () => {
    const message = `Delete “${notebook.title}”, its sources and notes? This can’t be undone.`;
    if (await confirmAction(message)) useTutorStore.getState().removeNotebook(notebook.id);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={`More actions for ${notebook.title}`}
          className={className}
          onClick={(event) => event.stopPropagation()}
        >
          <EllipsisVertical />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-misty-layer-portal>
        <NotebookShareItems notebook={notebook} onError={onError} />
        <DropdownMenuSeparator />
        <MenuItem icon={Trash2} label="Delete notebook" danger onSelect={() => void remove()} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * the Lab's home, after NotebookLM's: a search across every notebook, the view, the order and
 * a new notebook; then what to research and the topics to start from
 * (TopicStart); then the notebooks as cards or rows, then any lessons. With no notebooks yet, an
 * empty state offers the first one in their place, and the bar keeps only the search.
 */
export function TutorHome({ actions }: { actions: TutorActions }) {
  const now = useNow();
  const notebooks = useTutorStore((state) => state.notebooks);
  const ready = useTutorStore((state) => state.ready);
  const { view, sort } = useHomeLayout((state) => state.value);
  const setView = (next: "grid" | "list") =>
    useHomeLayout.getState().set((current) => ({ ...current, view: next }));
  const setSort = (next: Sort) =>
    useHomeLayout.getState().set((current) => ({ ...current, sort: next }));
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  const list = ordered(Object.values(notebooks), sort);
  const open = (notebook: Notebook) => actions.open(`notebook:${notebook.id}`);
  const create = () => open(useTutorStore.getState().createNotebook("Untitled notebook"));
  const empty = ready && list.length === 0;

  return (
    <div className="@container/library mx-auto flex w-full max-w-295 flex-col gap-4.5 px-8 pt-7 pb-12">
      {/* The search beside the controls, or above them when the page is too narrow for both. */}
      <div className="flex items-center gap-2 @max-lg/library:flex-col @max-lg/library:items-stretch">
        <SearchAll actions={actions} />
        {/* Nothing to order or lay out yet, and the empty state has the one Create button. */}
        {empty ? null : (
          <div className="ml-auto flex items-center justify-end gap-1.5">
            <CollectionSortMenu value={sort} options={sorts} onChange={setSort} />
            <ToolbarDivider />
            <CollectionViewToggle value={view} onChange={setView} />
            <Button
              variant="primary"
              className="mr-1"
              onClick={create}
              icon={Plus}
              data-tour="lab-new"
            >
              Create notebook
            </Button>
          </div>
        )}
      </div>

      <span data-tour="lab-start" className="contents">
        <TopicStart actions={actions} onError={setError} />
      </span>

      {empty ? (
        <span data-tour="lab-new" className="contents">
          <EmptyState
            inline
            title="No notebooks yet"
            line="A notebook keeps what you learn about one topic: its sources, notes and questions."
            action={{ label: "Create notebook", icon: Plus, onClick: create }}
          />
        </span>
      ) : (
        <>
          <Text as="h2" size="title" weight="medium" tone="bright" className="mt-1.5">
            Notebooks
          </Text>
          {view === "grid" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
              {!ready
                ? // The card itself, holding its emoji, title and detail line as placeholders.
                  [0, 1, 2, 3, 4, 5].map((index) => (
                    <Surface
                      key={index}
                      tone="card"
                      edge="hairline"
                      radius="xl"
                      className={cardClass}
                      aria-hidden="true"
                    >
                      <Skeleton className="size-6 rounded-md" />
                      <div className="mt-auto flex h-5 items-center">
                        <Skeleton className={index % 2 ? "h-4 w-1/2" : "h-4 w-2/3"} />
                      </div>
                      <div className="flex h-4 items-center">
                        <Skeleton className="h-3 w-2/5" />
                      </div>
                    </Surface>
                  ))
                : list.map((notebook) => (
                    <div key={notebook.id} className="relative">
                      <Surface
                        as={Pressable}
                        tone="card"
                        edge="hairline"
                        radius="xl"
                        wash="card"
                        className={`${cardClass} w-full`}
                        onClick={() => open(notebook)}
                      >
                        <Text bare size="display" className="leading-none" aria-hidden="true">
                          {notebook.emoji ?? "📓"}
                        </Text>
                        <Text
                          lines={2}
                          size="page"
                          weight="medium"
                          tone="bright"
                          className="mt-auto leading-[1.3]"
                        >
                          {notebook.title}
                        </Text>
                        <Text bare size="caption" tone="muted" className="flex-none">
                          {dateLabel(notebook.createdAt)} · {sourcesLabel(notebook.sources.length)}
                          {notebook.shared ? ` · Shared with ${notebook.shared.spaceName}` : null}
                        </Text>
                      </Surface>
                      <NotebookMenu
                        notebook={notebook}
                        className="absolute top-2 right-2"
                        onError={setError}
                      />
                    </div>
                  ))}
            </div>
          ) : (
            <div className="flex flex-col" role="list">
              <Surface tone="none" edge="hairline" className={rowEdge} aria-hidden="true">
                <Text
                  as="div"
                  bare
                  size="caption"
                  tone="muted"
                  className={`${rowGrid} min-h-9 text-left`}
                >
                  <span />
                  <span>Title</span>
                  <span>Sources</span>
                  <span>Last opened</span>
                  <span />
                </Text>
              </Surface>
              {!ready
                ? // The row's own cells: emoji, title, sources and when it was last opened.
                  [0, 1, 2, 3, 4, 5].map((index) => (
                    <Surface
                      key={index}
                      tone="none"
                      edge="hairline"
                      className={`${rowGrid} ${rowEdge} min-h-12 text-left`}
                      aria-hidden="true"
                    >
                      <Skeleton className="size-5 rounded-md" />
                      <Skeleton className={index % 2 ? "h-3.5 w-1/2" : "h-3.5 w-2/3"} />
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="h-3 w-12" />
                      <span />
                    </Surface>
                  ))
                : list.map((notebook) => (
                    <div key={notebook.id} className="relative" role="listitem">
                      <Surface
                        as={Pressable}
                        tone="none"
                        edge="hairline"
                        wash="control"
                        className={`${rowGrid} ${rowEdge} min-h-12 w-full text-left`}
                        onClick={() => open(notebook)}
                      >
                        <span aria-hidden="true">{notebook.emoji ?? "📓"}</span>
                        <Text tone="bright">{notebook.title}</Text>
                        <Text bare size="caption" tone="muted" className="flex-none">
                          {sourcesLabel(notebook.sources.length)}
                        </Text>
                        <Text bare size="caption" tone="muted" className="flex-none">
                          {shortAgo(notebook.updatedAt, now)}
                        </Text>
                        <span />
                      </Surface>
                      <NotebookMenu
                        notebook={notebook}
                        className="absolute top-2 right-2"
                        onError={setError}
                      />
                    </div>
                  ))}
            </div>
          )}
        </>
      )}

      <SharedNotebooks onOpen={(notebookId) => actions.open(`notebook:${notebookId}`)} />
      <TutorLessons onLesson={actions.onChat} />
    </div>
  );
}
