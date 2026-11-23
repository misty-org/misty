import { useState, type ReactNode } from "react";
import { Button, Mark, OptionSelect, Shelf, ShelfSkeleton, SkeletonControl } from "@misty/ui";

const FOLDED = 6;
const PAGE = 60;

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
        icon: <Mark of={`engine:${entry.id}`} size="1em" label={entry.name} aria-hidden />,
      }))}
    />
  );
}

export function MarketSkeleton({ label, logos = true }: { label: string; logos?: boolean }) {
  return (
    <>
      <div aria-hidden="true" className="flex min-w-0 items-center gap-2">
        <SkeletonControl kind="select" className="w-48" />
        <span className="flex-1" />
        <SkeletonControl kind="icon" />
        <SkeletonControl kind="icon" />
      </div>
      <MarketShelvesSkeleton label={label} logos={logos} />
    </>
  );
}

export function MarketShelvesSkeleton({ label, logos = true }: { label: string; logos?: boolean }) {
  return (
    <>
      <ShelfSkeleton label={label} logos={logos} />
      <ShelfSkeleton label={label} logos={logos} />
    </>
  );
}
