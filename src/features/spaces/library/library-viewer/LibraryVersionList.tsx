import type { LibraryEditVersion } from "../../api/dto/entities";
import { SystemErrorNotice } from "@/shared/platform/systemErrors";
import { Button, IconButton, Pressable, Surface, Text } from "@/shared/ui";
import { Trash2 } from "lucide-react";
import { formatTime } from "../libraryFormat";
import { libraryRenditionStatus } from "../SpaceLibraryViewerUtils";

interface LibraryVersionListProps {
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
    <section className="mt-6 border-t pt-5">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-sm">Versions</h3>
        {canEdit ? (
          <Button
            variant="secondary"
            type="button"
            disabled={editSaving || !activeEdit}
            onClick={() => props.onSelect()}
          >
            Original
          </Button>
        ) : !activeEdit ? (
          <Text bare tone="muted" className="text-3xs">
            Original selected
          </Text>
        ) : null}
      </div>
      {props.error ? (
        <SystemErrorNotice
          error={props.error}
          scope="library:versions"
          title="Library version could not be updated"
        />
      ) : null}

      <div className="mt-3 grid gap-1">
        {props.versions.map((version) => (
          <Surface
            tone="card"
            // The current edit stands out by its stronger edge.
            edge={version.is_current ? "strong" : "hairline"}
            radius="lg"
            className="flex items-center gap-2 px-2 py-2"
            key={version.id}
          >
            <Pressable
              className="min-w-0 flex-1"
              disabled={!canEdit || editSaving || version.is_current}
              onClick={() => props.onSelect(version.id)}
            >
              <span className="block text-xs font-medium">
                Edit {version.version_number}
                {version.is_current ? " · Current" : ""}
              </span>
              <Text bare tone="muted" className="mt-0.5 block text-3xs">
                {libraryRenditionStatus(version)} · {formatTime(version.created_at)}
              </Text>
            </Pressable>
            {canEdit &&
            (version.rendition_state === "none" || version.rendition_state === "failed") ? (
              <Button
                variant="secondary"
                type="button"
                disabled={editSaving}
                onClick={() => props.onRender(version.id)}
              >
                Render
              </Button>
            ) : null}
            {canEdit && !version.is_current ? (
              <IconButton
                size="sm"
                label={`Delete edit ${version.version_number}`}
                disabled={editSaving}
                onClick={() => props.onDelete(version.id)}
              >
                <Trash2 />
              </IconButton>
            ) : null}
          </Surface>
        ))}
      </div>
    </section>
  );
}
