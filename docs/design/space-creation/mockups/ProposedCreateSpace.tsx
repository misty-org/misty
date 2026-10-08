import { useState, type ReactNode } from "react";
import { Check, Library, ListTodo, MessagesSquare, NotebookPen, Plus, X } from "lucide-react";
import { avatarColorClass, avatarInkClass } from "@/shared/lib/avatarPalette";
import {
  Avatar,
  AvatarFallback,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Pressable,
  Skeleton,
  Spinner,
  cn,
} from "@/shared/ui";
import {
  builtInTemplates,
  existingSpaces,
  knownPeople,
  personalTemplates,
  seedCounts,
  type PrototypeTemplate,
} from "./data";

export type ProposedState = "default" | "loading" | "blank" | "invites" | "mine" | "creating" | "error";

type Tab = "templates" | "mine";

function initials(name: string) {
  const words = name.trim().split(/[\s@.]+/).filter(Boolean);
  if (!words.length) return "S";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export function ProposedCreateSpace({ state }: { state: ProposedState }) {
  const initialTemplate =
    state === "blank"
      ? builtInTemplates[0]
      : state === "mine"
        ? personalTemplates[0]
        : builtInTemplates[1];
  const [tab, setTab] = useState<Tab>(state === "mine" ? "mine" : "templates");
  const [selected, setSelected] = useState<PrototypeTemplate>(initialTemplate);
  const [name, setName] = useState(state === "blank" ? "" : initialTemplate.suggestedName);
  const choose = (template: PrototypeTemplate) => {
    // A template fills the name only while the person hasn't typed their own.
    if (!name || name === selected.suggestedName) setName(template.suggestedName);
    setSelected(template);
  };
  const loading = state === "loading";
  const creating = state === "creating";

  return (
    <Dialog open>
      <DialogContent
        aria-describedby="create-space-description"
        className="max-w-[880px] gap-0 overflow-hidden p-0 max-[760px]:max-h-[calc(100dvh-2rem)]"
      >
        <header className="px-6 pb-4 pt-5">
          <DialogTitle className="text-lg">Create a Space</DialogTitle>
          <DialogDescription id="create-space-description" className="mt-1">
            Pick a starting point. Everything can be changed later.
          </DialogDescription>
        </header>

        <div className="grid h-[min(540px,calc(100dvh-12rem))] min-h-0 grid-cols-[minmax(0,1fr)_300px] border-t border-charcoal-border max-[760px]:h-[calc(100dvh-13rem)] max-[760px]:grid-cols-1 max-[760px]:grid-rows-[auto_minmax(0,1fr)]">
          <section className="min-h-0 overflow-y-auto px-6 py-4">
            <div className="mb-3 flex gap-1.5" role="group" aria-label="Start from">
              {(
                [
                  ["templates", "Templates"],
                  ["mine", "Mine"],
                ] as const
              ).map(([id, label]) => (
                <Button
                  key={id}
                  variant="chip"
                  size="sm"
                  aria-pressed={tab === id}
                  onClick={() => setTab(id)}
                >
                  {label}
                </Button>
              ))}
            </div>
            {tab === "templates" ? (
              loading ? (
                <TemplateGridSkeleton />
              ) : (
                <TemplateGrid templates={builtInTemplates} selected={selected} onSelect={choose} />
              )
            ) : (
              <div className="grid gap-5">
                <TemplateGrid templates={personalTemplates} selected={selected} onSelect={choose} />
                <div>
                  <p className="m-0 mb-2 text-xs font-medium text-cream-muted">
                    Copy a Space's structure
                  </p>
                  <div className="grid grid-cols-3 gap-2 max-[760px]:grid-cols-2">
                    {existingSpaces.map((space) => (
                      <Pressable
                        key={space}
                        className="flex items-center gap-2.5 rounded-lg border border-charcoal-border px-3 py-2.5 text-left text-sm hover:bg-charcoal-hover"
                      >
                        <Avatar shape="tile" className="size-6">
                          <AvatarFallback className={cn(avatarColorClass(space), avatarInkClass)}>
                            {initials(space)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 truncate">{space}</span>
                      </Pressable>
                    ))}
                  </div>
                  <p className="m-0 mt-2 text-xs text-cream-muted">
                    Copies task titles, note outlines, collection names and channels. Files,
                    messages and members stay behind.
                  </p>
                </div>
              </div>
            )}
          </section>

          <aside className="grid min-h-0 content-start gap-5 overflow-y-auto border-l border-charcoal-border bg-charcoal-workspace/40 px-5 py-4 max-[760px]:order-first max-[760px]:border-b max-[760px]:border-l-0">
            <label className="grid gap-2 text-xs font-medium text-cream-muted">
              Name
              <span className="flex items-center gap-3">
                <Avatar shape="tile" className="size-10 shrink-0">
                  <AvatarFallback
                    className={cn(avatarColorClass(name || "new-space"), avatarInkClass)}
                  >
                    {initials(name)}
                  </AvatarFallback>
                </Avatar>
                <Input
                  value={name}
                  maxLength={80}
                  placeholder="Design team"
                  onChange={(event) => setName(event.target.value)}
                />
              </span>
            </label>

            <InvitePeople preset={state === "invites"} />

            {/* Narrow windows keep the counts on each card instead of the full preview. */}
            <div className="max-[760px]:hidden">
              <SeedPreview template={selected} loading={loading} />
            </div>
          </aside>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-charcoal-border px-6 py-3">
          {state === "error" ? (
            <p role="alert" className="m-0 mr-auto text-sm text-cream">
              The Space wasn't created. Check your connection and try again.
            </p>
          ) : null}
          <Button variant="outline" disabled={creating}>
            Cancel
          </Button>
          <Button disabled={creating || !name.trim()} aria-busy={creating}>
            {creating ? <Spinner size="sm" label={false} /> : null}
            Create Space
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

/** People you share a Space with are one-click toggles; anyone else is added by email. */
function InvitePeople({ preset }: { preset: boolean }) {
  const [picked, setPicked] = useState<string[]>(
    preset ? [knownPeople[0].email, knownPeople[1].email] : [],
  );
  const [emails, setEmails] = useState<string[]>(preset ? ["dana@studio.dev"] : []);
  const [draft, setDraft] = useState("");
  const toggle = (email: string) =>
    setPicked((list) =>
      list.includes(email) ? list.filter((item) => item !== email) : [...list, email],
    );
  const add = () => {
    const email = draft.trim();
    if (!email || emails.includes(email)) return;
    setEmails((list) => [...list, email]);
    setDraft("");
  };
  return (
    <div className="grid gap-2 text-xs font-medium text-cream-muted">
      Invite people
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="People from your Spaces">
        {knownPeople.map((person) => {
          const on = picked.includes(person.email);
          return (
            <Button
              key={person.email}
              variant="outline"
              size="sm"
              aria-pressed={on}
              className="h-8 gap-1.5 rounded-full pl-1 pr-2.5 font-normal"
              onClick={() => toggle(person.email)}
            >
              <PersonAvatar label={person.name} />
              {person.name.split(" ")[0]}
              {on ? <Check aria-hidden="true" className="size-3.5" /> : null}
            </Button>
          );
        })}
        {emails.map((email) => (
          <Button
            key={email}
            variant="outline"
            size="sm"
            aria-pressed
            aria-label={`Remove ${email}`}
            className="h-8 gap-1.5 rounded-full pl-1 pr-2 font-normal"
            onClick={() => setEmails((list) => list.filter((item) => item !== email))}
          >
            <PersonAvatar label={email} />
            {email}
            <X aria-hidden="true" className="size-3.5 text-cream-muted" />
          </Button>
        ))}
      </div>
      <form
        className="flex gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <Input
          type="email"
          value={draft}
          placeholder="Add by email"
          aria-label="Add by email"
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={!draft.trim()} aria-label="Add">
          <Plus aria-hidden="true" />
        </Button>
      </form>
      <span className="font-normal">Invitations send once the Space exists.</span>
    </div>
  );
}

function PersonAvatar({ label }: { label: string }) {
  return (
    <Avatar className="size-6">
      <AvatarFallback className={cn("text-[10px]", avatarColorClass(label), avatarInkClass)}>
        {initials(label)}
      </AvatarFallback>
    </Avatar>
  );
}

function TemplateGrid({
  templates,
  selected,
  onSelect,
}: {
  templates: PrototypeTemplate[];
  selected: PrototypeTemplate;
  onSelect: (template: PrototypeTemplate) => void;
}) {
  return (
    <div
      className="grid grid-cols-3 gap-2 max-[760px]:grid-cols-2"
      role="radiogroup"
      aria-label="Templates"
    >
      {templates.map((template) => {
        const active = selected.id === template.id;
        const Icon = template.icon;
        return (
          <Pressable
            key={template.id}
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(template)}
            className={cn(
              "grid content-start gap-1.5 rounded-lg border p-3 text-left",
              active
                ? "border-cream-muted/60 bg-charcoal-hover"
                : "border-charcoal-border hover:bg-charcoal-hover",
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Icon size={16} strokeWidth={2} aria-hidden="true" className="shrink-0 text-cream" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-cream-bright">
                {template.name}
              </span>
              {active ? (
                <Check size={15} aria-hidden="true" className="shrink-0 text-cream-bright" />
              ) : null}
            </span>
            <span className="line-clamp-2 text-xs leading-relaxed text-cream-muted">
              {template.description}
            </span>
            <span className="text-[11px] text-cream-muted/80">{seedCounts(template.seed)}</span>
          </Pressable>
        );
      })}
    </div>
  );
}

function TemplateGridSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-2" role="status" aria-label="Templates">
      {Array.from({ length: 9 }, (_, index) => (
        <div key={index} className="grid gap-2 rounded-lg border border-charcoal-border p-3">
          <span className="flex items-center gap-2">
            <Skeleton className="size-4" />
            <Skeleton className="h-3.5 w-1/2" />
          </span>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

function SeedPreview({ template, loading }: { template: PrototypeTemplate; loading: boolean }) {
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
  const seed = template.seed;
  const empty = !seed.tasks.length && !seed.note && !seed.collections.length;
  return (
    <div className="grid gap-3">
      <p className="m-0 text-xs font-medium text-cream-muted">You'll get</p>
      {empty ? (
        <p className="m-0 text-sm text-cream-muted">
          An empty Space with Chat, Planner, Journal and Library ready to use.
        </p>
      ) : (
        <>
          <PreviewRow icon={<MessagesSquare size={15} />} title="Chat" items={seed.channels} />
          {seed.tasks.length ? (
            <PreviewRow icon={<ListTodo size={15} />} title="Planner" items={seed.tasks} />
          ) : null}
          {seed.note ? (
            <PreviewRow icon={<NotebookPen size={15} />} title="Journal" items={[seed.note]} />
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
          {items.map((item) => (
            <li key={item} className="truncate">
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
