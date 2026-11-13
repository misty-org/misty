import { Skeleton, SkeletonControl, cn } from "@/shared/ui";

/** Each paragraph's lines, by width; the last line of each runs short, as text does. */
const paragraphs = [
  ["w-full", "w-11/12", "w-3/5"],
  ["w-full", "w-full", "w-5/6", "w-2/5"],
  ["w-11/12", "w-1/2"],
];

/**
 * A doc while it opens, shaped like the note editor: its 48px toolbar when the doc is editable,
 * then the 980px canvas with its 42px by 72px padding and lines at the editor's 1.72 line height.
 */
export function NoteDocumentSkeleton({
  label,
  toolbar = false,
  className,
}: {
  label: string;
  /** The doc opens editable, so its formatting toolbar shows above the text. */
  toolbar?: boolean;
  className?: string;
}) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className={cn("min-h-full", className)}>
      <span className="sr-only">{label}</span>
      {toolbar ? (
        <div className="flex h-12 items-center gap-0.5 border-b px-3" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <SkeletonControl key={index} kind="icon" />
          ))}
        </div>
      ) : null}
      <div className="mx-auto max-w-245 px-18 pt-10.5" aria-hidden="true">
        {paragraphs.map((lines, paragraph) => (
          <div key={paragraph} className="mb-3">
            {lines.map((width, line) => (
              <div key={line} className="flex h-7 items-center">
                <Skeleton className={cn("h-3.5", width)} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
