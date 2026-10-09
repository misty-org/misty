import { Trash2 } from "lucide-react";
import { useAuth } from "@/features/auth";
import { useTabArchiveStore } from "@/features/workspace/tabArchive";
import { IconButton, ListRow, ListRowButton } from "@/shared/ui";
import { InternalPageEmpty, SiteIcon } from "./InternalPageFrame";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Tabs closed for being idle, newest first, for this account. */
export function ArchivedTabsList(props: {
  text: string;
  navigate(url: string): void;
  openInNewView(url: string): void;
}) {
  const { user } = useAuth();
  const all = useTabArchiveStore((state) => state.tabs);
  const needle = props.text.trim().toLocaleLowerCase();
  const tabs = all.filter(
    (tab) =>
      tab.accountId === user?.id &&
      (!needle || `${tab.title} ${tab.url}`.toLocaleLowerCase().includes(needle)),
  );
  if (!tabs.length)
    return (
      <InternalPageEmpty
        title={needle ? "No matching archived tabs" : "No archived tabs"}
        detail="Turn on Archive idle tabs in Browsing settings to close tabs you haven't looked at for a while. They are listed here."
      />
    );
  return (
    <ul className="grid">
      {tabs.map((tab) => (
        <ListRow key={tab.id}>
          <span className="w-24 shrink-0 text-xs tabular-nums text-cream-muted">
            {new Date(tab.archivedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
          <SiteIcon url={tab.url} />
          <ListRowButton
            className="flex-col gap-0.5 @min-[40rem]/browser-page:flex-row @min-[40rem]/browser-page:gap-2"
            title={tab.url}
            onClick={(event) =>
              event.metaKey || event.ctrlKey
                ? props.openInNewView(tab.url)
                : props.navigate(tab.url)
            }
          >
            <span className="max-w-full truncate text-sm text-cream-bright">
              {tab.title || hostOf(tab.url)}
            </span>
            <span className="max-w-full truncate text-xs text-cream-muted">{hostOf(tab.url)}</span>
          </ListRowButton>
          <IconButton
            size="xs"
            label={`Remove ${tab.title || tab.url} from archived tabs`}
            tooltip="Remove"
            className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
            onClick={() => useTabArchiveStore.getState().remove(tab.id)}
          >
            <Trash2 className="size-3.5" />
          </IconButton>
        </ListRow>
      ))}
    </ul>
  );
}
