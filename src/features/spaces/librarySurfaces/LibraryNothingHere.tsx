import { Button } from "@/ui";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";

export function LibraryNothingHere() {
  return (
    <div className="grid min-h-48 place-items-center text-sm text-cream-muted">
      Nothing to see here...
    </div>
  );
}

/** The "← Collections" link that returns from a leaf collection to the overview. */
export function BackToCollections({ label = "Collections" }: { label?: string }) {
  const { collectionActions } = useSpaceLibraryContext();
  return (
    <Button
      className="mb-4 border-0 bg-transparent p-0 text-xs text-cream-muted"
      type="button"
      onClick={() => collectionActions.selectCollection("collections")}
    >
      ← {label}
    </Button>
  );
}
