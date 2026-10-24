import { useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { spacesApi } from "@/api/spaces/api";
import { useCodingIncluded } from "@/features/agents";
import { FileInput, Pressable, cn } from "@/shared/ui";
import { createSpaceItem, type SpaceCreateKind } from "./createSpaceItem";
import { MakeArt } from "./MakeArt";

type Tile = { id: SpaceCreateKind; label: string };

const tiles: Tile[] = [
  { id: "chat", label: "Chat" },
  { id: "note", label: "Note" },
  { id: "drawing", label: "Drawing" },
  { id: "file", label: "File" },
  { id: "code", label: "Code" },
];

/**
 * The Space home's first row: one tile per thing a person can make, each with a small
 * gray drawing of it. File opens the system picker and uploads into the Space in place.
 */
export function MakeSomethingNew({
  spaceId,
  onCreated,
}: {
  spaceId: string;
  onCreated: () => void;
}) {
  const navigate = useNavigate();
  const coding = useCodingIncluded();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const picker = useRef<HTMLInputElement>(null);

  // File uploads right here, into the Space, without leaving the home page.
  async function upload(files: File[]) {
    if (!files.length) return;
    setError("");
    setBusy("file");
    try {
      for (const file of files) await spacesApi.uploadLibraryBlob(spaceId, file, file.name);
      onCreated();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "Couldn't add that file. Try again.",
      );
    } finally {
      setBusy("");
      if (picker.current) picker.current.value = "";
    }
  }

  async function make(tile: Tile) {
    setError("");
    setBusy(tile.id);
    try {
      await createSpaceItem(spaceId, tile.id, navigate, () => picker.current?.click(), onCreated);
    } catch {
      setError(`Couldn't make a new ${tile.label.toLowerCase()}. Try again.`);
    } finally {
      setBusy("");
    }
  }

  return (
    <section aria-label="Create" className="flex flex-col gap-3">
      <h2 className="m-0 text-sm font-normal text-cream-muted">Create</h2>
      <FileInput
        ref={picker}
        multiple
        aria-hidden
        tabIndex={-1}
        onChange={(event) => void upload(Array.from(event.target.files ?? []))}
      />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        {tiles.map((tile) => (
          <Pressable
            key={tile.id}
            disabled={busy !== ""}
            onClick={() => void make(tile)}
            className="group/make flex flex-col gap-2 text-left"
          >
            <Frame>
              <MakeArt kind={tile.id} />
            </Frame>
            <span className="flex items-center gap-2 px-0.5 text-sm text-cream-bright">
              {tile.label}
              {tile.id === "code" && coding === false && (
                <span className="rounded border border-charcoal-border px-1.5 text-[10px] text-cream-muted">
                  Pro
                </span>
              )}
            </span>
          </Pressable>
        ))}
      </div>
      {error && (
        <p role="alert" className="m-0 text-sm text-cream">
          {error}
        </p>
      )}
    </section>
  );
}

/** The tile's double frame: an outer rim, then an inset panel holding the drawing. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <span
      className={cn(
        "block rounded-xl border border-charcoal-border bg-charcoal-card p-1.5",
        "group-hover/make:border-cream-muted/40 group-focus-visible/make:border-cream-muted",
      )}
    >
      <span className="grid h-24 place-items-center rounded-lg border border-charcoal-border bg-charcoal-workspace">
        {children}
      </span>
    </span>
  );
}
