import type { LibraryItemMetadataPatch } from "@/services/spaces/dto/interfaces/SpaceLibraryViewer";
import type { SpaceLibraryItem } from "@/services/spaces/dto/interfaces/types";
import { Button, Input, Textarea } from "@/shared/ui";
import { useEffect, useState, type FormEvent } from "react";
import { LibraryMetadataRow } from "../SpaceLibraryViewerUtils";

const labelClass = "grid gap-1.5 text-[10px] font-medium capitalize text-cream-muted";

/**
 * Editable name, caption and tags — or a read-only summary without permission.
 *
 * The draft lives here rather than in the viewer so switching items resets the
 * fields without the viewer having to know these three fields exist.
 */
export function LibraryMetadataForm({
  item,
  canEdit,
  onUpdate,
}: {
  item: SpaceLibraryItem;
  canEdit: boolean;
  onUpdate: (item: SpaceLibraryItem, patch: LibraryItemMetadataPatch) => Promise<unknown>;
}) {
  const [displayName, setDisplayName] = useState(item.display_name);
  const [caption, setCaption] = useState(item.caption);
  const [tags, setTags] = useState(item.tags.join(", "));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDisplayName(item.display_name);
    setCaption(item.caption);
    setTags(item.tags.join(", "));
  }, [item.caption, item.display_name, item.id, item.tags, item.version]);

  if (!canEdit) {
    return (
      <dl className="m-0 grid gap-3 text-xs">
        <LibraryMetadataRow label="Name" value={item.display_name} />
        <LibraryMetadataRow label="Caption" value={item.caption} />
        <LibraryMetadataRow label="Tags" value={item.tags.join(", ")} />
      </dl>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = displayName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await onUpdate(item, {
        display_name: name,
        caption: caption.trim(),
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)}>
      <label className={labelClass}>
        Name
        <Input
          value={displayName}
          maxLength={255}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </label>
      <label className={`mt-4 ${labelClass}`}>
        Caption
        <Textarea
          className="min-h-24 resize-y"
          value={caption}
          maxLength={4000}
          onChange={(event) => setCaption(event.target.value)}
        />
      </label>
      <label className={`mt-4 ${labelClass}`}>
        Tags
        <Input
          value={tags}
          placeholder="project, receipt, reference"
          onChange={(event) => setTags(event.target.value)}
        />
      </label>
      <Button
        className="mt-4 w-full"
        size="sm"
        type="submit"
        disabled={saving || !displayName.trim()}
      >
        {saving ? "Saving…" : "Save metadata"}
      </Button>
    </form>
  );
}
