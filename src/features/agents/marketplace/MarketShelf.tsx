import { useState, type ReactNode } from "react";
import { Button, OptionSelect, Shelf, ShelfSkeleton, SkeletonControl } from "@misty/ui";
import { EngineMark } from "@/features/engine-config/EngineMark";

/** Items a folded shelf shows: three rows of two. */
const FOLDED = 6;
/** Items an opened shelf adds each time Show more is pressed. */
const PAGE = 60;

/**
 * A shelf of a catalog's items: folded to a few, with See all at its heading that opens it to the
 * rest a page at a time. Give it a `key` that changes with the filter, so it folds again.
 */
export function MarketShelf<T>({
  title,
  items,
  render,
}: {
  title: string;
  items: readonly T[];
  render: (item: T) => ReactNode;
}) {
  const [shown, setShown] = useState(FOLDED);
  const open = shown > FOLDED;
  return (
    <div className="grid min-w-0 gap-3">
      <Shelf
        title={title}
        action={
          items.length > FOLDED ? (
            <Button variant="quiet" size="sm" onClick={() => setShown(open ? FOLDED : PAGE)}>
              {open ? "Show fewer" : "See all"}
            </Button>
          ) : undefined
        }
      >
        {items.slice(0, shown).map(render)}
      </Shelf>
      {open && items.length > shown ? (
        <Button
          variant="quiet"
          className="justify-self-start"
          onClick={() => setShown((count) => count + PAGE)}
        >
          Show more
        </Button>
      ) : null}
    </div>
  );
}

/** The agent a section adds to, picked from the installed ones, each with its own mark. */
export function EnginePicker({
  engines,
  engine,
  onPick,
}: {
  engines: { id: string; name: string }[];
  engine: string;
  onPick(engine: string): void;
}) {
  return (
    <OptionSelect
      aria-label="Engine"
      className="w-48 shrink-0"
      value={engine}
      onValueChange={onPick}
      options={engines.map((entry) => ({
        value: entry.id,
        label: entry.name,
        icon: <EngineMark engine={entry.id} name={entry.name} />,
      }))}
    />
  );
}

/** A section's first load: its control row, then shelves in their own shape. */
export function MarketSkeleton({ label }: { label: string }) {
  return (
    <>
      <div aria-hidden="true" className="flex min-w-0 items-center gap-2">
        <SkeletonControl kind="select" className="w-48" />
        <SkeletonControl kind="button-sm" />
        <SkeletonControl kind="button-sm" />
        <span className="flex-1" />
        <SkeletonControl kind="icon" />
        <SkeletonControl kind="icon" />
      </div>
      <MarketShelvesSkeleton label={label} />
    </>
  );
}

/** Shelves before their items are listed. */
export function MarketShelvesSkeleton({ label }: { label: string }) {
  return (
    <>
      <ShelfSkeleton label={label} />
      <ShelfSkeleton label={label} />
    </>
  );
}
