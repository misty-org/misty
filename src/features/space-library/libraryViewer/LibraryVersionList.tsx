import type { LibraryEditVersion } from "@/services/spaces/dto/interfaces/types";
import { Button } from "@/shared/ui";
import { Trash2 } from "lucide-react";
import { formatTime } from "../libraryFormat";
import { libraryRenditionStatus } from "../SpaceLibraryViewerUtils";

export interface LibraryVersionListProps {
  versions: LibraryEditVersion[];
  activeEdit: LibraryEditVersion | null;
  canEdit: boolean;
  editSaving: boolean;
  error: string;
  onSelect: (editID?: string) => void;
  onRender: (editID: string) => void;
  onDelete: (editID: string) => void;
}

/** Edit history, with the original as an explicit entry at the top. */
export function LibraryVersionList(props: LibraryVersionListProps) {
  const { canEdit, activeEdit, editSaving } = props;

  return (
    <section className="mt-6 border-t border-charcoal-border/60 pt-5">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-sm">Versions</h3>
        {canEdit ? (
          <Button
            className={!activeEdit ? "text-cream" : undefined}
            size="sm"
            variant="outline"
            type="button"
            disabled={editSaving || !activeEdit}
            onClick={() => props.onSelect()}
          >
            Original
          </Button>
        ) : !activeEdit ? (
          <span className="text-[10px] text-cream-muted">Original selected</span>
        ) : null}
      </div>
      {props.error ? <p className="mb-0 mt-3 text-xs text-cream-bright">{props.error}</p> : null}

      <div className="mt-3 grid gap-1">
        {props.versions.map((version) => (
          <div
            className={`flex items-center gap-2 rounded-lg bg-charcoal-card px-2 py-2 ${version.is_current ? "ring-1 ring-charcoal-active" : ""}`}
            key={version.id}
          >
            <Button
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left"
              type="button"
              disabled={!canEdit || editSaving || version.is_current}
              onClick={() => props.onSelect(version.id)}
            >
              <span className="block text-xs font-medium">
                Edit {version.version_number}
                {version.is_current ? " · Current" : ""}
              </span>
              <span className="mt-0.5 block text-[10px] text-cream-muted">
                {libraryRenditionStatus(version)} · {formatTime(version.created_at)}
              </span>
            </Button>
            {canEdit &&
            (version.rendition_state === "none" || version.rendition_state === "failed") ? (
              <Button
                size="sm"
                variant="outline"
                type="button"
                disabled={editSaving}
                onClick={() => props.onRender(version.id)}
              >
                Render
              </Button>
            ) : null}
            {canEdit && !version.is_current ? (
              <Button
                className="grid size-6 place-items-center border-0 bg-transparent text-cream-muted"
                type="button"
                disabled={editSaving}
                onClick={() => props.onDelete(version.id)}
                aria-label={`Delete edit ${version.version_number}`}
              >
                <Trash2 size={12} />
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
