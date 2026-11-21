import { useEffect, useState } from "react";
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
  CollectionHeading,
  CollectionPage,
  CollectionSortMenu,
  CollectionViewToggle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  FilterChip,
  HomeSection,
  homeItemsClass,
  homeItemsWrapClass,
  IconButton,
  MenuItem,
  Skeleton,
  spaceHomeClass,
  Surface,
  Text,
  ToolbarDivider,
  Tooltip,
  useNotice,
} from "@misty/ui";
import { spacesGateway } from "../spaces-gateway/spacesGateway";
import { useStudioOpen, useTeamMembers, type TeamMember } from "../now/teamMembers";
import { PersonAvatar } from "./notebook/LivePeople";
import { NotebookCard, NotebookRow } from "./NotebookCard";
import { deleteNotebook } from "./notebookSpace";
import { personTone } from "./personTone";
import { NotebookSearchResults, SearchAll, useNotebookSearch } from "./SearchAll";
import { TopicStart } from "./TopicStart";
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

/** A notebook as a row: its mark, title over what's happening, its facts, who, its menu. */
const rowGrid =
  "grid w-full grid-cols-[--spacing(7)_minmax(0,1fr)_minmax(0,--spacing(55))_--spacing(18)_--spacing(8)] items-center gap-3 px-2 " +
  "@max-[38.75rem]:grid-cols-[--spacing(7)_minmax(0,1fr)_--spacing(18)_--spacing(8)] @max-[38.75rem]:[&>:nth-child(3)]:hidden";
/** Each row stands on a hairline. */
const rowEdge = "min-h-12 border-0 border-b text-left";

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
    const message = notebook.space
      ? `Delete “${notebook.title}”, its sources and notes, for everyone in this Space? This can’t be undone.`
      : `Delete “${notebook.title}”, its sources and notes? This can’t be undone.`;
    if (!(await confirmAction(message))) return;
    await deleteNotebook(notebook.id).catch((error: unknown) =>
      onError(error instanceof Error ? error.message : "The notebook couldn’t be deleted."),
    );
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

/** Who else is in the Lab now, as faces, each saying which notebook they're in. */
function LabFaces({ spaceId, members }: { spaceId: string; members: TeamMember[] }) {
  if (!members.length) return null;
  return (
    <span className="flex flex-none items-center -space-x-1.5" aria-label="In the Lab now">
      {members.slice(0, 4).map((member) => (
        <Tooltip
          key={member.userId}
          content={member.notebook ? `${member.name} in ${member.notebook}` : member.name}
        >
          <span className="inline-flex">
            <PersonAvatar
              spaceId={spaceId}
              person={{ id: member.userId, name: member.name, tone: personTone(member.userId) }}
            />
          </span>
        </Tooltip>
      ))}
    </span>
  );
}

/**
 * The Lab's home, a page of its Space, built like the Space's home: a bar with the Space and the
 * Lab, who's in it now, a search and a new notebook; then what to explore and the topics to start
 * from (TopicStart); then the notebooks, all of them or only yours, as the Space's own cards or as
 * rows. Nothing is shared by hand: a notebook is the Space's from the start.
 */
export function TutorHome({ actions }: { actions: TutorActions }) {
  // Who else is in the Lab and in which notebook, for the faces; and that this person is in the
  // Lab, for theirs.
  useEffect(() => useStudioOpen.getState().enter(), []);
  useEffect(() => {
    const gateway = spacesGateway.maybe();
    if (!gateway || !actions.spaceId) return;
    gateway.setPlace({ spaceId: actions.spaceId, place: "lab" });
    return () => gateway.leavePlace("lab", "");
  }, [actions.spaceId]);
  const gateway = spacesGateway.maybe();
  const me = gateway?.me()?.userId;
  const inLab = useTeamMembers((state) => state.members).filter((member) => member.place === "lab");
  const notebooks = useTutorStore((state) => state.notebooks);
  const ready = useTutorStore((state) => state.ready);
  const loadError = useTutorStore((state) => state.error);
  const { view, sort } = useHomeLayout((state) => state.value);
  const setView = (next: "grid" | "list") =>
    useHomeLayout.getState().set((current) => ({ ...current, view: next }));
  const setSort = (next: Sort) =>
    useHomeLayout.getState().set((current) => ({ ...current, sort: next }));
  const [yours, setYours] = useState(false);
  const search = useNotebookSearch();
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  // This Lab shows its Space's notebooks, and any not given a Space yet (they get this one).
  const inSpace = Object.values(notebooks).filter(
    (notebook) => !notebook.space || notebook.space.spaceId === actions.spaceId,
  );
  const list = ordered(
    yours
      ? inSpace.filter((notebook) => !notebook.createdBy || notebook.createdBy === me)
      : inSpace,
    sort,
  );
  const open = (notebook: Notebook) => actions.open(`notebook:${notebook.id}`);
  const create = () => open(useTutorStore.getState().createNotebook("Untitled notebook"));
  const empty = ready && inSpace.length === 0;
  const Crumb = gateway?.SpaceCrumb;

  const controls =
    empty || loadError ? null : (
      <>
        <FilterChip
          size="sm"
          label="All"
          pressed={!yours}
          onPressedChange={() => setYours(false)}
        />
        <FilterChip
          size="sm"
          label="Yours"
          pressed={yours}
          onPressedChange={() => setYours(true)}
        />
        <ToolbarDivider />
        <CollectionSortMenu value={sort} options={sorts} onChange={setSort} />
        <ToolbarDivider />
        <CollectionViewToggle value={view} onChange={setView} />
      </>
    );

  return (
    <CollectionPage className="flex-1">
      <CollectionHeading
        title={Crumb && actions.spaceId ? <Crumb spaceId={actions.spaceId} here="Lab" /> : "Lab"}
        end={
          <div className="flex min-w-0 items-center gap-2">
            <LabFaces spaceId={actions.spaceId} members={inLab} />
            <SearchAll search={search} />
            <Button variant="primary" icon={Plus} onClick={create} data-tour="lab-new">
              New notebook
            </Button>
          </div>
        }
      />
      {/* A search shows its results where the notebooks were, in the page, not in a popup. */}
      {search.searching ? (
        <div className={spaceHomeClass}>
          <HomeSection
            title="Results"
            count={search.result ? search.result.hits.length : undefined}
          >
            <NotebookSearchResults search={search} actions={actions} />
          </HomeSection>
        </div>
      ) : (
        <div className={spaceHomeClass}>
          <span data-tour="lab-start" className="contents">
            <TopicStart actions={actions} onError={setError} />
          </span>

          <HomeSection title="Notebooks" count={ready ? list.length : undefined} action={controls}>
            {loadError ? (
              <ErrorState
                inline
                title="Notebooks couldn't load"
                line={loadError}
                action={{
                  label: "Try again",
                  onClick: () =>
                    void useTutorStore.getState().load(useTutorStore.getState().accountId),
                  variant: "secondary",
                }}
              />
            ) : empty ? (
              <EmptyState
                inline
                title="No notebooks yet"
                line="A notebook keeps what you learn about one topic: its sources, notes and questions."
                action={{
                  label: "New notebook",
                  icon: Plus,
                  onClick: create,
                  variant: "secondary",
                }}
              />
            ) : !ready ? (
              <NotebookCardsSkeleton />
            ) : !list.length ? (
              <Text bare tone="muted" className="py-6 text-center text-sm">
                You haven’t made a notebook in this Space yet.
              </Text>
            ) : view === "grid" ? (
              <div className={homeItemsWrapClass}>
                <div className={homeItemsClass}>
                  {list.map((notebook) => (
                    <NotebookCard
                      key={notebook.id}
                      notebook={notebook}
                      onOpen={() => open(notebook)}
                    >
                      <Surface
                        tone="card"
                        radius="md"
                        className={
                          "absolute top-2 right-2 opacity-0 group-hover/card:opacity-100 " +
                          "group-focus-within/card:opacity-100 has-[[data-state=open]]:opacity-100"
                        }
                      >
                        <NotebookMenu notebook={notebook} onError={setError} />
                      </Surface>
                    </NotebookCard>
                  ))}
                </div>
              </div>
            ) : (
              <div className="@container flex flex-col" role="list">
                {list.map((notebook) => (
                  <NotebookRow
                    key={notebook.id}
                    notebook={notebook}
                    className={`${rowGrid} ${rowEdge}`}
                    onOpen={() => open(notebook)}
                  >
                    <NotebookMenu
                      notebook={notebook}
                      className="absolute top-2 right-2"
                      onError={setError}
                    />
                  </NotebookRow>
                ))}
              </div>
            )}
          </HomeSection>
        </div>
      )}
    </CollectionPage>
  );
}

/** The notebooks' cards before they are read: a picture, a title, and two lines each. */
export function NotebookCardsSkeleton() {
  return (
    <div className={homeItemsWrapClass} aria-busy="true">
      <div className={homeItemsClass} aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="min-w-0">
            <Surface tone="card" radius="xl" className="aspect-[16/10] w-full" />
            <div className="px-0.5 pt-2.5">
              <div className="flex h-6 items-center gap-2">
                <Skeleton className="size-4 shrink-0 rounded-sm" />
                <Skeleton className={index % 2 ? "h-4 w-1/2" : "h-4 w-2/3"} />
              </div>
              <div className="mt-1 flex h-5 items-center">
                <Skeleton className="h-3.5 w-3/5" />
              </div>
              <div className="mt-1.5 flex h-5 items-center">
                <Skeleton className="h-3.5 w-1/3" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
