import { useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ListFilter,
  MoreHorizontal,
  Plus,
  Star,
} from "lucide-react";
import {
  Button,
  CollectionPage,
  CollectionHeading,
  CollectionSearch,
  CollectionFilters,
  CollectionItems,
  CollectionViewToggle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconButton,
} from "@/shared/ui";
import { areaLabels, itemIcons } from "./controls";
import { filterItems, type Filter, type Item, type ItemKind, type Scenario } from "./model";

export function Collection({
  items,
  filter,
  setFilter,
  onFavorite,
  onOpen,
  onNew,
  area,
  scenario,
}: {
  items: Item[];
  filter: Filter;
  setFilter: (value: Filter) => void;
  onFavorite: (id: string) => void;
  onOpen: (item: Item) => void;
  onNew: (kind: ItemKind) => void;
  area?: string;
  scenario: Scenario;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [sort, setSort] = useState("activity");
  const creatingFromMenu = useRef(false);
  const candidates =
    scenario === "empty" ? [] : area ? items.filter((i) => areaLabels[i.kind] === area) : items;
  const visible = area
    ? candidates
        .filter((i) => i.title.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) =>
          sort === "name" ? a.title.localeCompare(b.title) : b.updated.localeCompare(a.updated),
        )
    : filterItems(candidates, filter, query, sort);
  return (
    <CollectionPage
      className={`prototype-collection ${!area && filter === "Suggested" ? "is-suggested" : ""}`}
    >
      <CollectionHeading
        title={area ?? "All"}
        actions={
          <>
            <CollectionSearch
              aria-label="Search this Space"
              placeholder="Search this Space"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="primary">
                  <Plus />
                  New
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onCloseAutoFocus={(event) => {
                  if (creatingFromMenu.current) {
                    event.preventDefault();
                    creatingFromMenu.current = false;
                  }
                }}
              >
                {(["note", "task", "drawing", "file", "chat"] as const).map((kind) => {
                  const Icon = itemIcons[kind];
                  return (
                    <DropdownMenuItem
                      key={kind}
                      onSelect={() => {
                        creatingFromMenu.current = true;
                        onNew(kind);
                      }}
                    >
                      <Icon />
                      New {kind}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <CollectionFilters
        options={(area ? [area] : ["Yours", "Suggested", "Favorites"]).map((label) => ({
          value: label,
          label,
        }))}
        value={area ?? filter}
        onChange={(value) => !area && setFilter(value as Filter)}
        filterControl={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Sort items" tooltip={false}>
                <ListFilter />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
                <DropdownMenuRadioItem value="activity">Last activity</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        }
        actions={
          <CollectionViewToggle value={view} onChange={setView} disabled={!visible.length} />
        }
      />
      <p className="collection-description">
        {area
          ? `Everything in ${area.toLowerCase()}, in one place.`
          : filter === "Yours"
            ? "The things you’ve made and shared in this Space."
            : filter === "Suggested"
              ? "A few things that could use your attention."
              : "The things you want to keep close."}
      </p>
      {scenario === "loading" ? (
        <div className="collection-empty" role="status">
          Loading items…
        </div>
      ) : visible.length ? (
        <CollectionItems
          view={view}
          categoryLabel={!area && filter === "Suggested" ? "Why it’s here" : "Area"}
          items={visible.map((item) => {
            const Icon = itemIcons[item.kind];
            return {
              id: item.id,
              title: item.title,
              icon: <Icon size={17} />,
              category: !area && filter === "Suggested" ? item.reason! : areaLabels[item.kind],
              updated: new Date(item.updated).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              }),
              creator: item.creator,
              onOpen: () => onOpen(item),
              marker: item.favorite ? (
                <Star
                  size={13}
                  aria-label="Favorite"
                  className="shrink-0 fill-current text-cream-muted"
                />
              ) : undefined,
              actions: (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton label={`Actions for ${item.title}`} tooltip={false}>
                      <MoreHorizontal />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onOpen(item)}>
                      <ArrowUpRight />
                      Open
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onFavorite(item.id)}>
                      <Star />
                      {item.favorite ? "Remove from favorites" : "Add to favorites"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            };
          })}
        />
      ) : (
        <div className="collection-empty">
          {query ? (
            <>
              <h2>No matching items</h2>
              <p>Try a different title or clear your search.</p>
              <Button variant="outline" onClick={() => setQuery("")}>
                Clear search
              </Button>
            </>
          ) : !area && filter === "Suggested" ? (
            <>
              <Check size={28} />
              <h2>You’re all caught up</h2>
              <p>Tasks and requests that need you will appear here.</p>
            </>
          ) : !area && filter === "Favorites" ? (
            <>
              <Star size={28} />
              <h2>Keep something close</h2>
              <p>Star a chat, task, note, drawing, or file to find it here.</p>
              <Button variant="outline" onClick={() => setFilter("Yours")}>
                Browse your items
              </Button>
            </>
          ) : (
            <>
              <h2>{area ? `No items in ${area.toLowerCase()} yet` : "Make this Space yours"}</h2>
              <p>Create a note, start a conversation, or add a file.</p>
              <Button variant="outline" onClick={() => onNew("note")}>
                Create a note
              </Button>
            </>
          )}
        </div>
      )}
    </CollectionPage>
  );
}
