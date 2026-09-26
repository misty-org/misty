import { Bookmark } from "lucide-react";
import { useMemo, useState } from "react";
import { useWorkspaceStore } from "@/features/workspace";
import { WebsiteGroupsManager } from "@/features/browser-workspace/WebsiteGroupsManager";
import {
  InternalPageEmpty,
  InternalPageFrame,
  internalRowClass,
  SiteIcon,
} from "./InternalPageFrame";
import type { BrowserInternalPageProps } from "./types";

/** Bookmarks are Misty's saved websites, organized in groups. */
export function BookmarksPage(props: BrowserInternalPageProps) {
  const [text, setText] = useState("");
  const groups = useWorkspaceStore((state) => state.websiteGroups);
  const websites = useWorkspaceStore((state) => state.savedWebsites);
  const matches = useMemo(() => {
    const needle = text.trim().toLowerCase();
    if (!needle) return [];
    return websites.filter(
      (site) =>
        site.fields.title.toLowerCase().includes(needle) ||
        site.fields.url.toLowerCase().includes(needle),
    );
  }, [text, websites]);
  const groupLabel = (id: string) =>
    groups.find((group) => group.id === id)?.fields.label ?? "";

  return (
    <InternalPageFrame
      title="Bookmarks"
      icon={Bookmark}
      search={{ value: text, placeholder: "Search bookmarks", onChange: setText }}
    >
      {text.trim() ? (
        matches.length ? (
          <ul className="grid">
            {matches.map((site) => (
              <li key={site.id} className={internalRowClass}>
                <SiteIcon url={site.fields.url} />
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-baseline gap-2 text-left focus-visible:outline-none"
                  title={site.fields.url}
                  onClick={(event) =>
                    event.metaKey || event.ctrlKey
                      ? props.openInNewTab(site.fields.url)
                      : props.navigate(site.fields.url)
                  }
                >
                  <span className="truncate text-sm text-cream-bright">{site.fields.title}</span>
                  <span className="shrink-0 truncate text-xs text-cream-muted">
                    {groupLabel(site.fields.group_id)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <InternalPageEmpty title="No matching bookmarks" />
        )
      ) : (
        <div className="overflow-hidden rounded-lg border border-charcoal-border">
          <WebsiteGroupsManager />
        </div>
      )}
    </InternalPageFrame>
  );
}
