import { Button } from "@/shared/ui";
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
      variant="link"
      size="none"
      className="mb-4 text-xs text-cream-muted"
      onClick={() => collectionActions.selectCollection("collections")}
    >
      ← {label}
    </Button>
  );
}
