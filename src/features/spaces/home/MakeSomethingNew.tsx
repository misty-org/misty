import { Code2, NotebookText, PenLine, Upload } from "lucide-react";
import { useState, type ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import { drawingsApi } from "@/api/drawings/api";
import { notesApi } from "@/api/notes/api";
import { useCodingIncluded } from "@/features/agents";
import { cn, itemToneClass, itemTones, Pressable, type ItemTone } from "@/shared/ui";
import { preloadSpaceSection } from "../SpaceSectionView";

type Tile = {
  id: "note" | "drawing" | "upload" | "code";
  label: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  tone: ItemTone;
};

const tiles: Tile[] = [
  { id: "note", label: "Note", Icon: NotebookText, tone: itemTones.note },
  { id: "drawing", label: "Drawing", Icon: PenLine, tone: itemTones.drawing },
  { id: "upload", label: "Upload", Icon: Upload, tone: itemTones.sheet },
  { id: "code", label: "Code project", Icon: Code2, tone: itemTones.code },
];

/**
 * One tile per thing a person can make in a Space. The tiles take a soft wash of
 * their kind's tone, the one place outside an icon glyph where a tone shows
 * (AGENTS.md, Space home exception).
 */
export function MakeSomethingNew({ spaceId, onCreated }: { spaceId: string; onCreated: () => void }) {
  const navigate = useNavigate();
  const coding = useCodingIncluded();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const base = `/spaces/${encodeURIComponent(spaceId)}`;

  async function make(tile: Tile) {
    setError("");
    setBusy(tile.id);
    try {
      if (tile.id === "note") {
        await preloadSpaceSection("notes");
        const note = await notesApi.create(spaceId, "Untitled note");
        onCreated();
        navigate(`${base}/notes?note=${encodeURIComponent(note.id)}`);
      } else if (tile.id === "drawing") {
        await preloadSpaceSection("drawings");
        const drawing = await drawingsApi.create(spaceId, "Untitled drawing");
        onCreated();
        navigate(`${base}/drawings/${encodeURIComponent(drawing.id)}`);
      } else {
        const section = tile.id === "upload" ? "library" : "code";
        await preloadSpaceSection(section);
        navigate(`${base}/${section}`);
      }
    } catch {
      setError(`Couldn't make a new ${tile.label.toLowerCase()}. Try again.`);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="mb-7" aria-label="Make something new">
      <p className="m-0 mb-3 text-xs text-cream-muted">Make something new</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
        {tiles.map((tile) => (
          <Pressable
            key={tile.id}
            disabled={busy !== ""}
            onClick={() => void make(tile)}
            className={cn(
              "rounded-xl border border-charcoal-border bg-charcoal-card p-1.5",
              "hover:border-cream-muted/40",
            )}
          >
            <span
              className={cn("grid h-20 place-items-center rounded-lg", itemToneClass(tile.tone))}
              style={{ backgroundColor: "color-mix(in srgb, currentColor 13%, transparent)" }}
              aria-hidden
            >
              <tile.Icon className="size-7" aria-hidden />
            </span>
            <span className="mt-2 flex items-center gap-1.5 px-1 pb-0.5 text-sm text-cream-bright">
              {tile.label}
              {tile.id === "code" && coding === false && (
                <span className="rounded-md border border-charcoal-border px-1.5 text-[10px] text-cream-muted">
                  Pro
                </span>
              )}
            </span>
          </Pressable>
        ))}
      </div>
      {error && <p role="alert" className="m-0 mt-2 text-sm text-cream">{error}</p>}
    </section>
  );
}
