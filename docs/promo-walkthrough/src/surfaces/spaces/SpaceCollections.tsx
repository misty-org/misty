import {
  Button,
  CollectionFilters,
  CollectionHeading,
  CollectionItems,
  CollectionPage,
  CollectionSearch,
  CollectionViewToggle,
  type CollectionColumn,
  type CollectionItem,
} from "@/shared/ui";
import { Check, Clock3, FileText, Hash, Image, MessagesSquare, Plus, Upload, UsersRound } from "lucide-react";
import type { ReactNode } from "react";
import { libraryItems, people, personalTasks, teamTasks } from "../../data/project";
import type { SpaceState } from "../../film/state";
import { Notebooks } from "../browser/sites/Staging";
import { DocThumb, Wireframe } from "./thumbnails";

const noop = () => {};

function Collection(props: {
  title: string;
  search: string;
  primary: ReactNode;
  filters: string[];
  view?: "list" | "grid";
  items: CollectionItem[];
  fields?: string[];
  creatorLabel?: string;
  categoryLabel?: string;
  columns?: CollectionColumn[];
}) {
  return (
    <CollectionPage className="px-8 pt-4">
      <CollectionHeading
        title={props.title}
        actions={
          <>
            <CollectionSearch placeholder={props.search} readOnly />
            {props.primary}
          </>
        }
      />
      <CollectionFilters
        options={props.filters.map((label) => ({ value: label, label }))}
        value={props.filters[0]}
        onChange={noop}
        actions={<CollectionViewToggle value={props.view ?? "list"} onChange={noop} />}
      />
      <CollectionItems
        items={props.items}
        view={props.view}
        fields={props.fields}
        categoryLabel={props.categoryLabel}
        creatorLabel={props.creatorLabel}
        columns={props.columns}
        showLastActivity={false}
      />
    </CollectionPage>
  );
}

const item = (id: string, title: string, icon: ReactNode, rest: Partial<CollectionItem> = {}): CollectionItem => ({
  id,
  title,
  icon,
  category: "",
  updated: "Oct 2",
  onOpen: noop,
  // Zero-width anchor so the film cursor can find the row's title.
  marker: <span data-t={`row-${id}`} className="inline-block h-4 w-0" />,
  ...rest,
});

export function PlannerPage({ state }: { state: SpaceState }) {
  const team = state.space === "team";
  const rows = team
    ? teamTasks.map((task) => ({
        ...task,
        who:
          task.title === "Export hero images" && (state.assign === "assigned" || state.assign === "done")
            ? "Sam Park"
            : task.who
              ? people[task.who].name
              : "Unassigned",
      }))
    : personalTasks.map((task) => ({ ...task, who: "Alex Rivera" }));
  return (
    <Collection
      title="Planner"
      search="Search planner"
      primary={
        <Button variant="primary">
          <Plus /> New task
        </Button>
      }
      filters={["Tasks", "Agenda", "Roadmaps"]}
      columns={(team ? ["Status", "Assigned to"] : ["Status", "Due"]).map((label) => ({
        key: label,
        label,
        render: (row) => row.metadata?.[label],
        sortValue: () => 0,
      }))}
      items={rows.map((task) =>
        item(task.title, task.title, task.status === "Completed" ? <Check /> : <Clock3 />, {
          metadata: { Status: task.status, "Assigned to": task.who, Due: "due" in task ? task.due : "" },
          category: "Planner",
        }),
      )}
    />
  );
}

export function JournalPage({ space }: { space: SpaceState["space"] }) {
  const notes =
    space === "personal"
      ? ["Launch brief", "Redirect map", "Meeting notes · Sep 29"]
      : ["Homepage copy", "Launch day plan", "Product descriptions"];
  return (
    <Collection
      title="Journal"
      search="Search journal"
      primary={
        <Button variant="primary">
          <Plus /> New note
        </Button>
      }
      filters={["Recent", "Pinned", "Notes", "Drawings"]}
      items={notes.map((title, index) => item(title, title, <FileText />, { category: "Note", updated: ["Oct 2", "Oct 1", "Sep 29"][index] }))}
      categoryLabel="Type"
    />
  );
}

const previews = {
  doc: <DocThumb />,
  wireframe: <Wireframe />,
  photo: <Notebooks className="size-full" />,
};

export function LibraryPage() {
  return (
    <Collection
      title="Library"
      search="Search library"
      primary={
        <Button variant="primary">
          <Upload /> Upload files
        </Button>
      }
      filters={["Files", "Favorites", "Albums", "Trash"]}
      view="grid"
      creatorLabel="Added by"
      items={libraryItems.map((file) =>
        item(file.title, file.title, file.kind === "doc" ? <FileText /> : <Image />, {
          category: file.type,
          creator: "Alex",
          preview: previews[file.kind],
        }),
      )}
    />
  );
}

export function ChatPage() {
  const rows: [string, ReactNode, string][] = [
    ["Everyone", <UsersRound key="a" />, "Channels"],
    ["Launch day", <Hash key="b" />, "Channels"],
    ["Sam", <MessagesSquare key="c" />, "Direct"],
  ];
  return (
    <Collection
      title="Chat"
      search="Search chat"
      primary={
        <Button variant="primary">
          <Plus /> New chat
        </Button>
      }
      filters={["All", "Channels", "Direct", "Connected"]}
      categoryLabel="Type"
      items={rows.map(([title, icon, category]) => item(title, title, icon, { category }))}
    />
  );
}
