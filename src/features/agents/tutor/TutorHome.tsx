import { useState } from "react";
import {
  ArrowDownAZ,
  CalendarPlus,
  Clock,
  EllipsisVertical,
  Plus,
  Settings2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { confirmAction } from "@/shared/lib/confirmAction";
import {
  Button,
  CollectionViewToggle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  OverflowFadeText,
  Pressable,
  Skeleton,
  useNotice,
} from "@/shared/ui";
import { shortAgo } from "../page/useChatStatuses";
import { companionAvailable } from "./cursor/companionOn";
import { CursorMenuItem } from "./notebook/NotebookBar";
import "./notebook/tutorBar.css";
import { SearchAll } from "./SearchAll";
import { TutorLessons } from "./TutorLessons";
import type { TutorActions } from "./TutorPage";
import { useTutorStore } from "./tutorStore";
import type { Notebook } from "./tutorTypes";

const sorts: readonly { value: "recent" | "title" | "created"; label: string; icon: LucideIcon }[] =
  [
    { value: "recent", label: "Most recent", icon: Clock },
    { value: "title", label: "Title", icon: ArrowDownAZ },
    { value: "created", label: "Date created", icon: CalendarPlus },
  ];
type Sort = (typeof sorts)[number]["value"];

function ordered(notebooks: Notebook[], sort: Sort): Notebook[] {
  return [...notebooks].sort((a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title)
      : sort === "created"
        ? b.createdAt.localeCompare(a.createdAt)
        : b.updatedAt.localeCompare(a.updatedAt),
  );
}

const sourcesLabel = (count: number) => `${count} ${count === 1 ? "source" : "sources"}`;
const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** A notebook's own menu, on its card or row. */
function NotebookMenu({ notebook, className }: { notebook: Notebook; className?: string }) {
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
        <MenuItem icon={Trash2} label="Delete notebook" danger onSelect={() => void remove()} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Tutor's home, after NotebookLM's: a search across every notebook, the view, the order, Tutor's
 * settings and a new notebook, then the notebooks as cards or rows, then any lessons.
 */
export function TutorHome({ actions }: { actions: TutorActions }) {
  const notebooks = useTutorStore((state) => state.notebooks);
  const ready = useTutorStore((state) => state.ready);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState<Sort>("recent");
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  const list = ordered(Object.values(notebooks), sort);
  const open = (notebook: Notebook) => actions.open(`notebook:${notebook.id}`);
  const create = () => open(useTutorStore.getState().createNotebook("Untitled notebook"));

  return (
    <div className="tutor-library">
      <div className="tutor-library-tools">
        <SearchAll actions={actions} />
        <div className="tutor-library-tools-end">
          <CollectionViewToggle value={view} onChange={setView} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="quiet">
                {sorts.find((option) => option.value === sort)?.label}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" data-misty-layer-portal>
              <MenuRadioGroup value={sort} onValueChange={(next) => setSort(next as Sort)}>
                {sorts.map((option) => (
                  <MenuRadioItem
                    key={option.value}
                    value={option.value}
                    icon={option.icon}
                    label={option.label}
                  />
                ))}
              </MenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {companionAvailable() && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Tutor settings">
                  <Settings2 />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" data-misty-layer-portal>
                <CursorMenuItem onError={setError} />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="primary" className="tutor-bar-create" onClick={create} icon={Plus}>
            Create new
          </Button>
        </div>
      </div>

      <h2>Notebooks</h2>
      {view === "grid" ? (
        <div className="tutor-library-grid">
          <Pressable className="tutor-library-card tutor-library-new" onClick={create}>
            <span className="tutor-library-new-icon">
              <Plus size={24} />
            </span>
            <span className="tutor-library-card-title">Create new notebook</span>
          </Pressable>
          {!ready
            ? [0, 1, 2].map((index) => (
                <Skeleton key={index} className="tutor-library-card" aria-hidden="true" />
              ))
            : list.map((notebook) => (
                <div key={notebook.id} className="relative">
                  <Pressable className="tutor-library-card w-full" onClick={() => open(notebook)}>
                    <span className="tutor-library-card-emoji" aria-hidden="true">
                      {notebook.emoji ?? "📓"}
                    </span>
                    <span className="tutor-library-card-title">{notebook.title}</span>
                    <span className="tutor-card-detail">
                      {dateLabel(notebook.createdAt)} · {sourcesLabel(notebook.sources.length)}
                    </span>
                  </Pressable>
                  <NotebookMenu notebook={notebook} className="tutor-library-menu" />
                </div>
              ))}
        </div>
      ) : (
        <div className="tutor-library-rows" role="list">
          <div className="tutor-library-row tutor-library-row-head" aria-hidden="true">
            <span />
            <span>Title</span>
            <span>Sources</span>
            <span>Last opened</span>
            <span />
          </div>
          {!ready ? (
            [0, 1, 2].map((index) => (
              <Skeleton key={index} className="tutor-library-row" aria-hidden="true" />
            ))
          ) : list.length ? (
            list.map((notebook) => (
              <div key={notebook.id} className="relative" role="listitem">
                <Pressable className="tutor-library-row w-full" onClick={() => open(notebook)}>
                  <span aria-hidden="true">{notebook.emoji ?? "📓"}</span>
                  <OverflowFadeText className="text-cream-bright">
                    {notebook.title}
                  </OverflowFadeText>
                  <span className="tutor-card-detail">{sourcesLabel(notebook.sources.length)}</span>
                  <span className="tutor-card-detail">{shortAgo(notebook.updatedAt)}</span>
                  <span />
                </Pressable>
                <NotebookMenu notebook={notebook} className="tutor-library-menu" />
              </div>
            ))
          ) : (
            <p className="tutor-library-empty">No notebooks yet</p>
          )}
        </div>
      )}

      <TutorLessons onLesson={actions.onChat} />
    </div>
  );
}
