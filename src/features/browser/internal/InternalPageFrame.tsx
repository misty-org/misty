import { SavedWebsiteIcon } from "@/features/browser-workspace/SavedWebsiteIcon";
import { CollectionHeading, CollectionPage, CollectionSearch, EmptyState } from "@/shared/ui";
import type { ReactNode } from "react";

/** Browser collections share their page geometry and controls with Spaces. */
export function InternalPageFrame(props: {
  title: string;
  search?: { value: string; placeholder: string; onChange: (value: string) => void };
  actions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <CollectionPage className="absolute inset-0 @container/browser-page" data-browser-internal-page>
      <CollectionHeading
        title={props.title}
        actions={
          <>
            {props.search ? (
              <CollectionSearch
                type="search"
                aria-label={props.search.placeholder}
                value={props.search.value}
                placeholder={props.search.placeholder}
                onChange={(event) => props.search?.onChange(event.target.value)}
              />
            ) : null}
            {props.actions}
          </>
        }
      />
      {props.toolbar}
      <div className="flex min-w-0 flex-1 shrink-0 flex-col">{props.children}</div>
    </CollectionPage>
  );
}

export function InternalPageEmpty(props: { title: string; detail?: string }) {
  return <EmptyState title={props.title} description={props.detail} />;
}

export function SiteIcon({ url }: { url: string }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center text-cream-muted">
      <SavedWebsiteIcon url={url} />
    </span>
  );
}
