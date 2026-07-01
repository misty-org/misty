import { useState, type FormEvent } from "react";
import { ArrowLeft, ChevronRight, Folder, Globe, Plus } from "lucide-react";
import { mistyBrowserProviders } from "@misty/sdk";
import { BrandIcon } from "../../../apps/shared/BrandIcon";
import { providers, type ProviderId } from "@/features/webviews/providers";
import { Button, Input } from "@/shared/ui";
import type { SharedRecord } from "./model";
import {
  addWebsite,
  expandWebsiteGroup,
  pinWebsite,
  saveWebsiteGroup,
  websiteAddress,
} from "./navigation";
import { defaultWebsiteGroups } from "./navigationDefaults";

const integrations = (Object.keys(providers) as ProviderId[]).map((id) => ({
  id,
  ...providers[id],
  url: mistyBrowserProviders[id].url,
}));
const presets = defaultWebsiteGroups();
type Site = { title: string; url: string };
type Draft = { id?: string; name: string; icon: string; options: Site[]; selected: string[] };
const rowClass = "h-10 w-full justify-start gap-3 px-2 [@media(hover:none)]:min-h-11";
const inputClass = "[@media(hover:none)]:min-h-11 [@media(hover:none)]:text-base";

export function WebsiteIntegrationPicker({
  groups,
  websites,
  initialGroupId,
  onDone,
}: {
  groups: SharedRecord<"group">[];
  websites: SharedRecord<"website">[];
  initialGroupId?: string;
  onDone(): void;
}) {
  function groupDraft(group: SharedRecord<"group">): Draft {
    const saved = websites
      .filter((site) => site.fields.group_id === group.id)
      .map((site) => ({ title: site.fields.title, url: site.fields.url }));
    const family = group.id.replace("group:default:", "").replace(/^social$/, "chat");
    const suggested = integrations
      .filter((item) => item.family === family)
      .map((item) => ({ title: item.label, url: item.url }));
    return {
      id: groups.some((item) => item.id === group.id) ? group.id : undefined,
      name: group.fields.label,
      icon: group.fields.icon,
      options: [
        ...saved,
        ...suggested.filter((item) => !saved.some((site) => site.url === item.url)),
      ],
      selected: saved.map((site) => site.url),
    };
  }
  const [query, setQuery] = useState("");
  const [step, setStep] = useState<"browse" | "custom" | "destination" | "group">(
    initialGroupId ? "group" : "browse",
  );
  const [draft, setDraft] = useState<Draft>(() => {
    const group = groups.find((item) => item.id === initialGroupId);
    return group ? groupDraft(group) : { name: "", icon: "globe", options: [], selected: [] };
  });
  const [pending, setPending] = useState<Site | null>(null);
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const search = query.trim().toLowerCase();
  const choices = integrations.filter((item) =>
    `${item.label} ${item.url}`.toLowerCase().includes(search),
  );
  const matchingPresets = presets.filter((item) =>
    item.fields.label.toLowerCase().includes(search),
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
  const newGroup = () => {
    setDraft({
      name: "",
      icon: "globe",
      options: pending ? [pending] : [],
      selected: pending ? [pending.url] : [],
    });
    setStep("group");
  };
  const submitCustom = (event: FormEvent) => {
    event.preventDefault();
    attempt(() => {
      const url = websiteAddress(address);
      if (name.trim().length > 160) throw new Error("Use a name of 160 characters or fewer.");
      choose({ title: name.trim() || new URL(url).hostname, url });
    });
  };
  const back = () => {
    setError(null);
    if (step === "group" && pending) setStep("destination");
    else {
      setStep("browse");
      setPending(null);
    }
  };
  return (
    <>
      <div className="shrink-0 border-b border-charcoal-border p-3">
        <div className="flex items-center gap-2">
          {step !== "browse" && (
            <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={back}>
              <ArrowLeft size={16} />
            </Button>
          )}
          <h2 className="min-w-0 text-sm font-medium text-cream-bright">
            {step === "browse"
              ? "Groups and integrations"
              : step === "custom"
                ? "Add custom url"
                : step === "destination"
                  ? "Add to group"
                  : draft.id
                    ? "Edit group"
                    : "Create group"}
          </h2>
        </div>
        {step === "browse" && (
          <Input
            autoFocus
            aria-label="Search groups and integrations"
            placeholder="Search groups and integrations"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={`mt-3 h-8 ${inputClass}`}
          />
        )}
        {step === "destination" && (
          <p className="mt-2 truncate text-sm text-cream-muted">{pending?.title}</p>
        )}
      </div>
      <div className="misty-transient-scrollbar min-h-0 max-h-[420px] overflow-y-auto">
        {step === "browse" && (
          <div className="p-1">
            {matchingPresets.length > 0 && (
              <p className="px-2 pb-1 pt-2 text-xs text-cream-muted">Premade groups</p>
            )}
            {matchingPresets.map((preset) => {
              const existing = groups.find(
                (group) =>
                  group.id === preset.id ||
                  (group.fields.icon === preset.fields.icon &&
                    group.fields.label === preset.fields.label),
              );
              return (
                <Button
                  key={preset.id}
                  aria-label={`${existing ? "Edit" : "Customize"} ${existing?.fields.label ?? preset.fields.label}`}
                  variant="ghost"
                  className={rowClass}
                  onClick={() => {
                    setDraft(groupDraft(existing ?? preset));
                    setStep("group");
                  }}
                >
                  <Folder size={18} />
                  <span className="flex-1 truncate text-left">
                    {existing?.fields.label ?? preset.fields.label}
                  </span>
                  <span className="text-xs text-cream-muted">
                    {existing ? "Edit" : "Customize"}
                  </span>
                  <ChevronRight size={14} />
                </Button>
              );
            })}
            {choices.length > 0 && (
              <p className="px-2 pb-1 pt-4 text-xs text-cream-muted">Popular integrations</p>
            )}
            {choices.map((item) => (
              <Button
                key={item.id}
                variant="ghost"
                className={rowClass}
                onClick={() => choose({ title: item.label, url: item.url })}
              >
                <BrandIcon brand={item.id} size={20} />
                <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                <ChevronRight size={14} className="text-cream-muted" />
              </Button>
            ))}
            {!matchingPresets.length && !choices.length && (
              <p className="px-2 py-5 text-sm text-cream-muted">
                No matches. Add a custom url or create a group.
              </p>
            )}
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
              Add to group
            </Button>
          </form>
        )}
        {step === "destination" && (
          <div className="p-1">
            {visibleGroups.map((group) => (
              <Button
                key={group.id}
                aria-label={group.fields.label}
                variant="ghost"
                className={rowClass}
                onClick={() => addToGroup(group.id)}
              >
                <Folder size={18} />
                <span className="flex-1 truncate text-left">{group.fields.label}</span>
                {websites.some(
                  (site) => site.fields.group_id === group.id && site.fields.url === pending?.url,
                ) && <span className="text-xs text-cream-muted">Added</span>}
              </Button>
            ))}
            {!visibleGroups.length && (
              <p className="px-2 py-3 text-sm text-cream-muted">
                Create a group for this integration.
              </p>
            )}
          </div>
        )}
        {step === "group" && (
          <form
            id="website-group-draft"
            className="grid gap-3 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              attempt(() => {
                saveWebsiteGroup(
                  draft.id,
                  draft.name,
                  draft.icon,
                  draft.options.filter((site) => draft.selected.includes(site.url)),
                );
                onDone();
              });
            }}
          >
            <label className="grid gap-1 text-xs text-cream-muted">
              Group name
              <Input
                autoFocus
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                maxLength={160}
                placeholder="Research"
                className={inputClass}
              />
            </label>
            <p className="text-xs text-cream-muted">
              {draft.options.length
                ? "Choose the integrations to keep in this group."
                : "Add integrations from the Groups picker whenever you need them."}
            </p>
            {draft.options.map((site) => (
              <label
                key={site.url}
                className="flex min-h-9 cursor-pointer items-center gap-3 text-sm [@media(hover:none)]:min-h-11"
              >
                <input
                  type="checkbox"
                  checked={draft.selected.includes(site.url)}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      selected: event.target.checked
                        ? [...draft.selected, site.url]
                        : draft.selected.filter((url) => url !== site.url),
                    })
                  }
                  className="size-4 accent-[var(--color-cream)]"
                />
                <span className="min-w-0 truncate">{site.title}</span>
              </label>
            ))}
          </form>
        )}
      </div>
      {error && (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {(step === "browse" || step === "destination" || step === "group") && (
        <div className="shrink-0 border-t border-charcoal-border p-1">
          {step === "browse" && (
            <Button
              variant="ghost"
              className={rowClass}
              onClick={() => {
                try {
                  setAddress(websiteAddress(query));
                } catch {
                  setAddress("");
                }
                setStep("custom");
              }}
            >
              <Globe size={18} />
              <span className="flex-1 text-left">Add custom url</span>
              <ChevronRight size={14} />
            </Button>
          )}
          {step !== "group" ? (
            <Button variant="ghost" className={rowClass} onClick={newGroup}>
              <Plus size={18} />
              Create group
            </Button>
          ) : (
            <Button
              form="website-group-draft"
              type="submit"
              className="w-full"
              disabled={!draft.name.trim()}
            >
              {draft.id ? "Save changes" : "Create group"}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
