import { SavedWebsiteIcon } from "@/features/browser-workspace/SavedWebsiteIcon";
import { cn, Input } from "@/shared/ui";
import type { LucideIcon } from "lucide-react";
import { Search } from "lucide-react";
import type { ReactNode } from "react";

/** The shared page chrome for misty:// pages: a title row, an optional
 * search box and actions, and a scrolling body. */
export function InternalPageFrame(props: {
  title: string;
  icon: LucideIcon;
  search?: { value: string; placeholder: string; onChange: (value: string) => void };
  actions?: ReactNode;
  children: ReactNode;
}) {
  const Icon = props.icon;
  return (
    <div
      className="absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-charcoal-bg text-cream"
      data-browser-internal-page
    >
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-charcoal-border px-6 py-4">
        <Icon className="size-5 text-cream-muted" aria-hidden="true" />
        <h1 className="mr-auto text-base font-semibold tracking-[-0.01em] text-cream-bright">
          {props.title}
        </h1>
        {props.search ? (
          <label className="relative w-full max-w-sm sm:w-72">
            <span className="sr-only">{props.search.placeholder}</span>
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-cream-muted"
              aria-hidden="true"
            />
            <Input
              type="search"
              className="h-8 pl-8"
              value={props.search.value}
              placeholder={props.search.placeholder}
              onChange={(event) => props.search?.onChange(event.target.value)}
            />
          </label>
        ) : null}
        {props.actions}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-5">{props.children}</div>
      </div>
    </div>
  );
}

export function InternalPageEmpty(props: { title: string; detail?: string }) {
  return (
    <div className="grid place-items-center gap-1 py-16 text-center">
      <p className="text-sm font-medium text-cream-bright">{props.title}</p>
      {props.detail ? <p className="max-w-sm text-xs text-cream-muted">{props.detail}</p> : null}
    </div>
  );
}

export function SiteIcon({ url }: { url: string }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center text-cream-muted">
      <SavedWebsiteIcon url={url} />
    </span>
  );
}
