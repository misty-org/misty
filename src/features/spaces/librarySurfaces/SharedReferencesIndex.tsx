import { ClipboardCopy, MessagesSquare, X } from "lucide-react";
import { Button } from "@/ui";
import type { LibrarySharedReference } from "@/models/interfaces/features/spaces/types";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { formatBytes } from "../libraryFormat";
import { BackToCollections, LibraryNothingHere } from "./LibraryNothingHere";

const cardClass = "rounded-xl bg-card p-4 shadow-xs inset-ring-1 inset-ring-foreground/10";
const gridClass = "grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3";

/** Library items shared into this Space, and items this Space shares out. */
export function SharedReferencesIndex() {
  const { data, itemActions, collectionActions } = useSpaceLibraryContext();
  const { collection, sharedReferences, outgoingReferences } = data;
  if (collection !== "shared") return null;

  return (
    <div className="mb-5">
      <BackToCollections />

      {sharedReferences.length > 0 ? (
        <section>
          <h4 className="mb-3 mt-0 text-sm">Shared with this Space</h4>
          <div className={gridClass}>
            {sharedReferences.map((reference) => (
              <article className={cardClass} key={reference.id}>
                <ReferenceHeading reference={reference} />
                <p className="mb-3 mt-1 truncate text-[10px] text-muted-foreground">
                  From {reference.source_space_name} · {formatBytes(reference.byte_size)}
                </p>
                {data.canCopyLibrary ? (
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    disabled={data.bulkSaving}
                    onClick={() => void itemActions.copySharedReferenceToClipboard(reference)}
                  >
                    <ClipboardCopy size={12} />
                    Copy
                  </Button>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {outgoingReferences.length > 0 ? (
        <section className="mt-7">
          <h4 className="mb-3 mt-0 text-sm">Shared by this Space</h4>
          <div className={gridClass}>
            {outgoingReferences.map((reference) => (
              <article className={cardClass} key={reference.id}>
                <ReferenceHeading reference={reference} />
                <p className="mb-3 mt-1 truncate text-[10px] text-muted-foreground">
                  To {reference.destination_space_name}
                </p>
                {data.canEditLibrary ? (
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={() => void collectionActions.revokeSharedReference(reference)}
                  >
                    <X size={12} />
                    Stop sharing
                  </Button>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {sharedReferences.length === 0 && outgoingReferences.length === 0 ? (
        <LibraryNothingHere />
      ) : null}
    </div>
  );
}

function ReferenceHeading({ reference }: { reference: LibrarySharedReference }) {
  return (
    <>
      <MessagesSquare size={20} />
      <p className="mb-0 mt-3 truncate text-xs font-medium">{reference.display_name}</p>
    </>
  );
}
