import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useWorkspaceStore } from "@/features/workspace";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui";
import { EditableGroupRow } from "./WebsiteSitePicker";
import { SavedWebsiteIcon } from "./SavedWebsiteIcon";
import { GroupIcon, groupIcons } from "./groupIcons";
import { readGroupIcon } from "./groupIconUpload";
import {
  addWebsite,
  createWebsiteGroup,
  removeWebsite,
  removeWebsiteGroup,
  renameWebsiteGroup,
} from "./navigation";

const reveal =
  "opacity-0 group-hover/manager-row:opacity-100 group-focus-within/manager-row:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100";
export function WebsiteGroupsManager() {
  const groups = useWorkspaceStore((state) => state.websiteGroups);
  const websites = useWorkspaceStore((state) => state.savedWebsites);
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ordered = [...groups]
    .filter((group) => !group.fields.hidden)
    .sort((a, b) => a.fields.order - b.fields.order);
  const group = ordered.find((item) => item.id === selected) ?? ordered[0];
  const sites = websites
    .filter((site) => site.fields.group_id === group?.id)
    .sort((a, b) => a.fields.order - b.fields.order);
  const run = (action: () => void) => {
    try {
      action();
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <>
      <div className="grid min-h-[520px] grid-cols-[210px_minmax(0,1fr)] max-sm:grid-cols-[120px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col border-r border-charcoal-border p-4 max-sm:p-2">
          <nav aria-label="Website groups" className="grid content-start gap-1">
            {ordered.map((item) => (
              <Button
                variant="ghost"
                size="none"
                justify="start"
                key={item.id}
                type="button"
                aria-current={group?.id === item.id ? "true" : undefined}
                className={`flex min-h-8 min-w-0 items-center gap-2 text-left text-[13px] outline-none hover:text-cream-bright focus-visible:ring-2 focus-visible:ring-cream-muted ${group?.id === item.id ? "font-medium text-cream-bright" : "text-cream-muted"}`}
                onClick={() => {
                  setSelected(item.id);
                  setAdding(false);
                  setError(null);
                }}
              >
                <GroupIcon name={item.fields.icon} size={18} />
                <span className="truncate">{item.fields.label}</span>
              </Button>
            ))}
          </nav>
          <div className="mt-auto pt-6">
            <Button
              variant="ghost"
              size="sm"
              className="px-0 text-sm text-cream-muted"
              onClick={() => {
                setError(null);
                setCreating(true);
              }}
            >
              <Plus className="size-4" /> Add group
            </Button>
            <Dialog open={creating} onOpenChange={setCreating}>
              <DialogContent className="sm:max-w-sm">
                <DialogTitle>Add group</DialogTitle>
                <DialogDescription>
                  Give your group a name to organize saved sites.
                </DialogDescription>
                <form
                  className="grid gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    run(() => {
                      setSelected(createWebsiteGroup(groupName));
                      setGroupName("");
                      setCreating(false);
                    });
                  }}
                >
                  <label className="grid gap-2 text-sm">
                    Group name
                    <Input
                      autoFocus
                      aria-label="New group name"
                      value={groupName}
                      onChange={(event) => setGroupName(event.target.value)}
                      maxLength={160}
                    />
                  </label>
                  {error && (
                    <p role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  )}
                  <DialogFooter>
                    <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={!groupName.trim()}>
                      Add
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>
        <div className="min-w-0 p-4 max-sm:p-3">
          {group ? (
            <div key={group.id}>
              <div className="flex min-w-0 items-center gap-2">
                <GroupIconPicker
                  key={group.id}
                  value={group.fields.icon}
                  onChange={(icon) =>
                    useWorkspaceStore.setState((state) => ({
                      websiteGroups: state.websiteGroups.map((item) =>
                        item.id === group.id ? { ...item, fields: { ...item.fields, icon } } : item,
                      ),
                    }))
                  }
                />
                <div className="min-w-0 flex-1">
                  <EditableGroupRow
                    label={group.fields.label}
                    inputLabel="Group name"
                    editLabel="Edit group name"
                    deleteLabel="Delete group"
                    onSave={(value) => renameWebsiteGroup(group.id, value)}
                    onDelete={() => removeWebsiteGroup(group.id)}
                    onError={setError}
                  />
                </div>
              </div>
              <div className="group/manager-row mb-2 mt-5 flex h-6 items-center justify-between">
                <h3 className="text-xs text-cream-muted">Sites</h3>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Add site to group"
                  className={`text-cream-muted ${reveal}`}
                  onClick={() => setAdding(!adding)}
                >
                  <Plus className="size-4" />
                </Button>
              </div>
              <div className="grid gap-1">
                {sites.map((site) => (
                  <EditableGroupRow
                    key={site.id}
                    icon={<SavedWebsiteIcon url={site.fields.url} />}
                    label={site.fields.title}
                    inputLabel="Site name"
                    editLabel={`Edit ${site.fields.title}`}
                    deleteLabel={`Delete ${site.fields.title}`}
                    onSave={(title) => {
                      if (!title.trim()) throw new Error("Enter a site name.");
                      useWorkspaceStore.setState((state) => ({
                        savedWebsites: state.savedWebsites.map((item) =>
                          item.id === site.id
                            ? { ...item, fields: { ...item.fields, title } }
                            : item,
                        ),
                      }));
                    }}
                    onDelete={() => removeWebsite(site.id)}
                    onError={setError}
                  />
                ))}
                {!sites.length && <p className="py-1 text-xs text-cream-muted">No sites</p>}
              </div>
              {adding && (
                <form
                  className="mt-3 grid gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    run(() => {
                      addWebsite(group.id, name, url);
                      setUrl("");
                      setName("");
                      setAdding(false);
                    });
                  }}
                >
                  <Input
                    autoFocus
                    aria-label="Site URL"
                    placeholder="Website URL"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    className="h-8 text-xs"
                  />
                  <Input
                    aria-label="Site name (optional)"
                    placeholder="Name (optional)"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={160}
                    className="h-8 text-xs"
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="xs" disabled={!url.trim()}>
                      Add site
                    </Button>
                    <Button variant="ghost" size="xs" onClick={() => setAdding(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </div>
          ) : (
            <p className="text-sm text-cream-muted">Create a group to organize your saved sites.</p>
          )}
        </div>
      </div>
      {error && !creating && (
        <p role="alert" className="px-4 pb-3 text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
function GroupIconPicker({ value, onChange }: { value: string; onChange(value: string): void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadRequest = useRef(0);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Choose group icon"
          title="Choose group icon"
          className="text-cream-muted"
        >
          <GroupIcon name={value} size={18} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3" aria-label="Group icons">
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Upload group icon"
          className="hidden"
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            const request = ++uploadRequest.current;
            setUploading(true);
            setUploadError("");
            try {
              const icon = await readGroupIcon(file);
              if (request !== uploadRequest.current) return;
              onChange(icon);
              setOpen(false);
              setQuery("");
            } catch (error) {
              if (request === uploadRequest.current)
                setUploadError(
                  error instanceof Error ? error.message : "Could not load this image.",
                );
            } finally {
              if (request === uploadRequest.current) setUploading(false);
            }
          }}
        />
        <Button
          variant="outline"
          size="sm"
          className="mb-2 w-full"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? "Loading image…" : "Upload image"}
        </Button>
        <p className="mb-3 text-xs text-cream-muted">PNG, JPG, or WebP · Up to 5 MB</p>
        {uploadError && (
          <p role="alert" className="mb-3 text-xs text-destructive">
            {uploadError}
          </p>
        )}
        <Input
          autoFocus
          aria-label="Search group icons"
          placeholder="Search icons"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="mb-3 h-8 text-xs"
        />
        <div className="grid max-h-60 grid-cols-6 gap-1 overflow-y-auto">
          {Object.entries(groupIcons)
            .filter(([id]) => id.replace(/-/g, " ").includes(query.trim().toLowerCase()))
            .map(([id, Icon]) => (
              <Button
                key={id}
                variant="ghost"
                size="icon-sm"
                aria-label={id.replace(/-/g, " ")}
                title={id.replace(/-/g, " ")}
                aria-pressed={value === id}
                className={
                  value === id ? "text-cream-bright ring-1 ring-cream-muted" : "text-cream-muted"
                }
                onClick={() => {
                  uploadRequest.current++;
                  setUploading(false);
                  setUploadError("");
                  onChange(id);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <Icon className="size-[18px]" />
              </Button>
            ))}
        </div>
        {!Object.keys(groupIcons).some((id) =>
          id.replace(/-/g, " ").includes(query.trim().toLowerCase()),
        ) && <p className="text-xs text-cream-muted">No icons found</p>}
      </PopoverContent>
    </Popover>
  );
}
