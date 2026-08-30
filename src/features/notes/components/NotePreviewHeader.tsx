import { Button } from "@/shared/ui";
import { ArrowRight } from "lucide-react";
import type { UnifiedNote } from "../model/types/types";

export function NotePreviewHeader(props: { note: UnifiedNote; onOpen: () => void }) {
  const title = props.note.title || "Untitled note";

  return (
    <div className="mb-2 flex h-8 shrink-0 items-center gap-2">
      <h2 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-cream-bright">
        {title}
      </h2>

      <Button
        type="button"
        size="sm"
        className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
        aria-label={`Open ${title}`}
        onClick={props.onOpen}
      >
        Open
        <ArrowRight data-icon="inline-end" className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}
