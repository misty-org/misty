import { useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "@/features/workspace";
import {
  addWebsite,
  createWebsiteGroup,
  removeWebsite,
} from "@/features/browser-workspace/navigation";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
} from "@/shared/ui";
import { useBrowserOverlayControl } from "./useBrowserOverlayControl";

const newGroupValue = "__new__";

/** Bookmark this page (⌘D) into one of the saved-website groups. */
export function BrowserBookmarkDialog(props: {
  request: number;
  url: string;
  title: string;
  suspensionReason: string;
}) {
  const overlay = useBrowserOverlayControl(props.suspensionReason);
  // Select the stored array and derive from it; a selector that builds a new
  // array on every read makes the store re-render forever.
  const websiteGroups = useWorkspaceStore((state) => state.websiteGroups);
  const groups = useMemo(
    () =>
      [...websiteGroups]
        .filter((group) => !group.fields.hidden)
        .sort((a, b) => a.fields.order - b.fields.order),
    [websiteGroups],
  );
  const existing = useWorkspaceStore((state) =>
    state.savedWebsites.find((site) => site.fields.url === props.url),
  );
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.request) return;
    setName(props.title);
    setGroupId(groups[0]?.id ?? newGroupValue);
    setError(null);
    overlay.onOpenChange(true);
    // Open once per request, with the page as it is at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.request]);

  const save = () => {
    try {
      const target = groupId === newGroupValue ? createWebsiteGroup("Bookmarks") : groupId;
      addWebsite(target, name.trim(), props.url);
      overlay.onOpenChange(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const groupName = groups.find((group) => group.id === existing?.fields.group_id)?.fields.label;
  return (
    <Dialog open={overlay.open} onOpenChange={overlay.onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogTitle>{existing ? "Bookmarked" : "Bookmark this page"}</DialogTitle>
        <DialogDescription>
          {existing
            ? `This page is saved${groupName ? ` in ${groupName}` : ""}.`
            : "Save this page to a group in your saved websites."}
        </DialogDescription>
        {existing ? (
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                removeWebsite(existing.id);
                overlay.onOpenChange(false);
              }}
            >
              Remove bookmark
            </Button>
            <Button type="button" onClick={() => overlay.onOpenChange(false)}>
              Done
            </Button>
          </DialogFooter>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <label className="grid gap-2 text-sm">
              Name
              <Input autoFocus value={name} maxLength={160} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="grid gap-2 text-sm">
              Group
              <select
                className="h-9 rounded-md border border-charcoal-border bg-charcoal-card px-2 text-sm text-cream"
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.fields.label}
                  </option>
                ))}
                <option value={newGroupValue}>New group “Bookmarks”</option>
              </select>
            </label>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => overlay.onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
