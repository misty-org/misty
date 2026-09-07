import type { ReactNode } from "react";
import { Library, ListTodo, MessagesSquare, NotebookPen } from "lucide-react";
import type { Space, SpaceTemplate } from "@/api/spaces/dto/interfaces/types";
import { Skeleton } from "@/shared/ui";

/** "You'll get": exactly what the chosen starting point creates. */
export function CreateSpaceSeedPreview({
  template,
  sourceSpace,
  loading,
}: {
  template?: SpaceTemplate;
  sourceSpace?: Space;
  loading: boolean;
}) {
  if (loading)
    return (
      <div className="grid gap-3" role="status" aria-label="What you'll get">
        <Skeleton className="h-3 w-24" />
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex gap-2.5">
            <Skeleton className="size-4" />
            <div className="grid flex-1 gap-1.5">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    );
  if (sourceSpace)
    return (
      <div className="grid gap-2">
        <p className="m-0 text-xs font-medium text-cream-muted">You'll get</p>
        <p className="m-0 text-sm text-cream-muted">
          {sourceSpace.name}'s task titles, outlines of your notes there and its collection names.
        </p>
      </div>
    );
  if (!template) return null;
  const seed = template.seed_preview;
  const empty = !seed.tasks.length && !seed.notes.length && !seed.collections.length;
  return (
    <div className="grid gap-3">
      <p className="m-0 text-xs font-medium text-cream-muted">You'll get</p>
      {empty ? (
        <p className="m-0 text-sm text-cream-muted">
          An empty Space with Chat, Planner, Journal and Library ready to use.
        </p>
      ) : (
        <>
          <PreviewRow icon={<MessagesSquare size={15} />} title="Chat" items={["Everyone"]} />
          {seed.tasks.length ? (
            <PreviewRow icon={<ListTodo size={15} />} title="Planner" items={seed.tasks} />
          ) : null}
          {seed.notes.length ? (
            <PreviewRow icon={<NotebookPen size={15} />} title="Journal" items={seed.notes} />
          ) : null}
          {seed.collections.length ? (
            <PreviewRow icon={<Library size={15} />} title="Library" items={seed.collections} />
          ) : null}
        </>
      )}
    </div>
  );
}

function PreviewRow({ icon, title, items }: { icon: ReactNode; title: string; items: string[] }) {
  return (
    <div className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5">
      <span className="mt-0.5 text-cream-muted" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="m-0 text-sm text-cream-bright">{title}</p>
        <ul className="m-0 mt-0.5 grid list-none gap-0.5 p-0 text-xs text-cream-muted">
          {items.map((item, index) => (
            <li key={`${index}:${item}`} className="truncate">
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
