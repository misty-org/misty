import { useState, type FormEvent, type ReactNode } from "react";
import { ChevronLeft, Pencil, Trash2, Folder, Globe, Search } from "lucide-react";
import { mistyBrowserProviders } from "@misty/sdk";
import { BrandIcon } from "../../shared/toolAssets/BrandIcon";
import { providers, type ProviderId } from "@/features/webviews/providers";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  Button,
  Input,
} from "@/shared/ui";
import { SavedWebsiteIcon } from "./SavedWebsiteIcon";
import type { SharedRecord } from "./model";
import {
  addWebsite,
  expandWebsiteGroup,
  pinWebsite,
  removeWebsiteGroup,
  saveWebsiteGroup,
  websiteAddress,
} from "./navigation";

const sites = (Object.keys(providers) as ProviderId[]).map((id) => ({
  id,
  ...providers[id],
  url: mistyBrowserProviders[id].url,
}));
type Site = { title: string; url: string };
type Draft = { id?: string; name: string; icon: string; options: Site[] };
const inputClass = "[@media(hover:none)]:min-h-11 [@media(hover:none)]:text-base";
function SiteRow({
  icon,
  label,
  actionLabel,
  onAdd,
}: {
  icon: ReactNode;
  label: string;
  actionLabel: string;
  onAdd(): void;
}) {
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-md px-2 py-1 hover:bg-charcoal-hover">
      {icon}
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <Button
        variant="secondary"
        size="sm"
        aria-label={actionLabel}
        onClick={onAdd}
        className="h-7 bg-charcoal-hover px-3 text-xs hover:bg-charcoal-active [@media(hover:none)]:min-h-11"
      >
        Add
      </Button>
    </div>
  );
}

export function WebsiteSitePicker({
  groups,
  websites,
  initialGroupId,
  initialSite,
  onDone,
}: {
  groups: SharedRecord<"group">[];
  websites: SharedRecord<"website">[];
  initialGroupId?: string;
  initialSite?: Site;
  onDone(): void;
}) {
  const [query, setQuery] = useState("");
  const [step, setStep] = useState<"browse" | "custom" | "destination" | "group">(
    initialGroupId ? "group" : initialSite ? "destination" : "browse",
  );
  const [draft, setDraft] = useState<Draft>(() => {
    const group = groups.find((item) => item.id === initialGroupId);
    const saved = websites
      .filter((site) => site.fields.group_id === initialGroupId)
      .map((site) => ({ title: site.fields.title, url: site.fields.url }));
    return {
      id: initialGroupId,
      name: group?.fields.label ?? "",
      icon: group?.fields.icon ?? "globe",
      options: saved,
    };
  });
  const [pending, setPending] = useState<Site | null>(initialSite ?? null);
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const search = query.trim().toLowerCase();
  const choices = sites.filter((item) =>
    `${item.label} ${item.url}`.toLowerCase().includes(search),
  );
  const visibleGroups = groups.filter((group) => !group.fields.hidden);
  const attempt = (action: () => void) => {
    try {
      action();
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  const choose = (site: Site) => {
    setPending(site);
    setStep("destination");
    setError(null);
  };
  const addToGroup = (groupId: string) =>
    attempt(() => {
      if (!pending) return;
      const existing = websites.find(
        (site) => site.fields.group_id === groupId && site.fields.url === pending.url,
      );
      if (existing) {
        pinWebsite(existing.id, true);
        expandWebsiteGroup(groupId, true);
      } else addWebsite(groupId, pending.title, pending.url);
      onDone();
    });
  const submitCustom = (event: FormEvent) => {
    event.preventDefault();
    attempt(() => {
      const url = websiteAddress(address);
      if (name.trim().length > 160) throw new Error("Use a name of 160 characters or fewer.");
      choose({ title: name.trim() || new URL(url).hostname, url });
    });
  };
  const searchSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    attempt(() => {
      try {
        const url = websiteAddress(query);
        choose({ title: new URL(url).hostname, url });
      } catch {
        if (choices[0]) choose({ title: choices[0].label, url: choices[0].url });
        else throw new Error("Choose a site or enter a website address, such as example.com.");
      }
    });
  };
  return (
    <>
      <div className="shrink-0 border-b border-charcoal-border p-3">
        <div className="flex items-center gap-2">
          {step !== "browse" && (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 gap-1 text-xs text-cream-muted"
              aria-label="Back to sites"
              onClick={() => {
                setStep("browse");
                setPending(null);
                setError(null);
              }}
            >
              <ChevronLeft className="size-3" /> Back
            </Button>
          )}
          {step !== "group" && (
            <h2 className="min-w-0 text-sm font-medium text-cream-bright">
              {step === "browse"
                ? "Sites"
                : step === "custom"
                  ? "Add a site"
                  : step === "destination"
                    ? "Add to group"
                    : "Edit group"}
            </h2>
          )}
        </div>
        {step === "browse" && (
          <form onSubmit={searchSubmit} className="relative mt-3">
            <Search
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-cream-muted"
            />
            <Input
              autoFocus
              aria-label="Search sites or paste a URL"
              placeholder="Search sites or paste a URL"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setError(null);
              }}
              className={`h-9 pl-8 ${inputClass}`}
            />
          </form>
        )}
        {step === "destination" && (
          <p className="mt-2 truncate text-sm text-cream-muted">{pending?.title}</p>
        )}
      </div>
      <div className="misty-transient-scrollbar min-h-0 max-h-[420px] overflow-y-auto">
        {step === "browse" && (
          <div className="p-2">
            <p className="px-2 pb-1 pt-2 text-xs text-cream-muted">
              {search ? "Sites" : "Popular sites"}
            </p>
            {choices.map((item) => (
              <SiteRow
                key={item.id}
                icon={<BrandIcon brand={item.id} size={20} />}
                label={item.label}
                actionLabel={`Add ${item.label}`}
                onAdd={() => choose({ title: item.label, url: item.url })}
              />
            ))}
            {!choices.length && <p className="px-2 py-5 text-sm text-cream-muted">No sites</p>}
          </div>
        )}
        {step === "custom" && (
          <form onSubmit={submitCustom} className="grid gap-3 p-3">
            <label className="grid gap-1 text-xs text-cream-muted">
              URL
              <Input
                autoFocus
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="example.com"
                autoComplete="url"
                autoCapitalize="none"
                spellCheck={false}
                className={inputClass}
              />
            </label>
            <label className="grid gap-1 text-xs text-cream-muted">
              Name (optional)
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={160}
                className={inputClass}
              />
            </label>
            <Button type="submit" size="sm" disabled={!address.trim()}>
              Add
            </Button>
          </form>
        )}
        {step === "destination" && (
          <div className="p-2">
            {visibleGroups.map((group) => (
              <SiteRow
                key={group.id}
                icon={<Folder size={18} />}
                label={group.fields.label}
                actionLabel={`Add to ${group.fields.label}`}
                onAdd={() => addToGroup(group.id)}
              />
            ))}
            {!visibleGroups.length && (
              <p className="px-2 py-3 text-sm text-cream-muted">Add a group below for this site.</p>
            )}
          </div>
        )}
        {step === "group" && (
          <div className="grid gap-3 p-3">
            <EditableGroupRow
              label={draft.name}
              inputLabel="Group name"
              editLabel="Edit group name"
              deleteLabel="Delete group"
              onSave={(name) => {
                saveWebsiteGroup(draft.id, name, draft.icon, draft.options);
                setDraft({ ...draft, name });
              }}
              onDelete={() => {
                if (draft.id) removeWebsiteGroup(draft.id);
                onDone();
              }}
              onError={setError}
            />
            <h3 className="text-xs text-cream-muted">Sites</h3>
            {!draft.options.length && <p className="text-xs text-cream-muted/60">No sites</p>}
            <div className="grid gap-1">
              {draft.options.map((site) => (
                <EditableGroupRow
                  key={site.url}
                  icon={<SavedWebsiteIcon url={site.url} />}
                  label={site.title}
                  inputLabel="Site name"
                  editLabel={`Edit ${site.title}`}
                  deleteLabel={`Delete ${site.title}`}
                  onSave={(title) => {
                    const options = draft.options.map((item) =>
                      item.url === site.url ? { ...item, title } : item,
                    );
                    saveWebsiteGroup(draft.id, draft.name, draft.icon, options);
                    setDraft({ ...draft, options });
                  }}
                  onDelete={() => {
                    const options = draft.options.filter((item) => item.url !== site.url);
                    saveWebsiteGroup(draft.id, draft.name, draft.icon, options);
                    setDraft({ ...draft, options });
                  }}
                  onError={setError}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {step !== "custom" && step !== "group" && (
        <div className="shrink-0 border-t border-charcoal-border p-2">
          {step === "browse" && (
            <SiteRow
              icon={<Globe size={18} />}
              label="Custom URL"
              actionLabel="Add custom URL"
              onAdd={() => {
                try {
                  setAddress(websiteAddress(query));
                } catch {
                  setAddress("");
                }
                setError(null);
                setStep("custom");
              }}
            />
          )}
          {step === "destination" && (
            <form
              className="flex items-center gap-3 p-1"
              onSubmit={(event) => {
                event.preventDefault();
                attempt(() => {
                  if (!pending) return;
                  if (
                    visibleGroups.some(
                      (group) =>
                        group.fields.label.toLowerCase() === groupName.trim().toLowerCase(),
                    )
                  )
                    throw new Error("That group already exists. Choose it above.");
                  saveWebsiteGroup(undefined, groupName, "globe", [pending]);
                  onDone();
                });
              }}
            >
              <Folder size={18} className="shrink-0 text-cream-muted" />
              <Input
                aria-label="New group name"
                placeholder="New group name"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                maxLength={160}
                className={`min-w-0 ${inputClass}`}
              />
              <Button type="submit" size="sm" disabled={!groupName.trim()}>
                Add
              </Button>
            </form>
          )}
        </div>
      )}
    </>
  );
}

export function EditableGroupRow({
  label,
  icon,
  inputLabel,
  editLabel,
  deleteLabel,
  onSave,
  onDelete,
  onError,
}: {
  label: string;
  icon?: ReactNode;
  inputLabel: string;
  editLabel: string;
  deleteLabel: string;
  onSave(value: string): void;
  onDelete(): void;
  onError(value: string | null): void;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [value, setValue] = useState(label);
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => void) => {
    try {
      action();
      setError(null);
      onError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return (
    <>
      <div className="group/edit-row flex min-h-9 min-w-0 items-center gap-2 text-sm">
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <div className="flex shrink-0 items-center opacity-0 group-hover/edit-row:opacity-100 group-focus-within/edit-row:opacity-100 [@media(hover:none)]:opacity-100">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={editLabel}
            className="text-cream-muted [@media(hover:none)]:size-11"
            onClick={() => {
              setValue(label);
              setError(null);
              setEditing(true);
            }}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={deleteLabel}
            className="text-cream-muted [@media(hover:none)]:size-11"
            onClick={() => {
              setError(null);
              setDeleting(true);
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-sm">
          <DialogTitle>{inputLabel === "Group name" ? "Edit group" : "Edit site"}</DialogTitle>
          <DialogDescription>Update the name shown in your groups.</DialogDescription>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              run(() => {
                onSave(value.trim());
                setEditing(false);
              });
            }}
          >
            <label className="grid gap-2 text-sm">
              {inputLabel}
              <Input
                autoFocus
                value={value}
                maxLength={160}
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                aria-label="Cancel editing"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                aria-label={`Save ${inputLabel.toLowerCase()}`}
                disabled={!value.trim()}
              >
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent className="sm:max-w-sm">
          <AlertDialogTitle>Delete “{label}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {inputLabel === "Group name"
              ? "This removes the group and all its saved sites. This cannot be undone."
              : "This removes the saved site from this group. This cannot be undone."}
          </AlertDialogDescription>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                run(() => {
                  onDelete();
                  setDeleting(false);
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
