// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
/**
 * Settings › Behavior › Personas: the bundled agency-agents catalog. Each persona can be switched
 * off for the `#` menu, read in full, or made into one of the person's own agents. Divisions
 * filter the list and switch a whole division at once.
 */
import { Bot, Check, Eye, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  FilterChip,
  IconButton,
  SearchField,
  Skeleton,
  Switch,
  useNotice,
  OverflowFadeText,
} from "@/shared/ui";
import {
  disabledPersonas,
  makeAgentFromPersona,
  onPersonasChanged,
  personaCatalog,
  personaPrompt,
  setPersonasEnabled,
  type CatalogPersona,
  type CatalogPrompt,
  type CatalogView,
} from "./catalogApi";

function CatalogSkeleton() {
  return (
    <div className="grid gap-2" aria-hidden="true">
      <div className="flex gap-1.5">
        {[56, 72, 64, 80, 60].map((width) => (
          <Skeleton key={width} className="h-6 rounded-md" style={{ width }} />
        ))}
      </div>
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="flex items-center gap-3 py-2">
          <Skeleton className="size-9 rounded-lg" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-72" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PersonaCatalogSection() {
  const [catalog, setCatalog] = useState<CatalogView>();
  const [disabled, setDisabled] = useState<ReadonlySet<string>>(new Set());
  const [division, setDivision] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [viewing, setViewing] = useState<{ persona: CatalogPersona; prompt?: CatalogPrompt }>();
  const [made, setMade] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let live = true;
    Promise.all([personaCatalog(), disabledPersonas()]).then(
      ([view, off]) => {
        if (!live) return;
        setCatalog(view);
        setDisabled(off);
      },
      () => live && setError("The persona catalog couldn't load."),
    );
    const stop = onPersonasChanged((off) => live && setDisabled(new Set(off)));
    return () => {
      live = false;
      stop();
    };
  }, []);

  const shown = useMemo(() => {
    if (!catalog) return [];
    const words = query.trim().toLowerCase();
    return catalog.agents.filter(
      (agent) =>
        (!division || agent.divisionId === division) &&
        (!words ||
          agent.name.toLowerCase().includes(words) ||
          agent.description.toLowerCase().includes(words)),
    );
  }, [catalog, division, query]);

  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });

  if (!catalog) return error ? null : <CatalogSkeleton />;

  const divisions = new Map(catalog.divisions.map((entry) => [entry.id, entry]));
  const enabledIn = (id: string | null) =>
    catalog.agents.filter((agent) => (!id || agent.divisionId === id) && !disabled.has(agent.id))
      .length;

  const toggle = async (ids: string[], enabled: boolean) => {
    setPending(true);
    setError("");
    try {
      await setPersonasEnabled(ids, enabled);
    } catch {
      setError("This change couldn't be saved. Try again.");
    } finally {
      setPending(false);
    }
  };

  const view = (persona: CatalogPersona) => {
    setViewing({ persona });
    personaPrompt(persona.id).then(
      (prompt) =>
        setViewing((current) =>
          current?.persona.id === persona.id ? { persona, prompt } : current,
        ),
      () => setError("This persona's prompt couldn't be read."),
    );
  };

  const make = async (persona: CatalogPersona) => {
    setError("");
    try {
      await makeAgentFromPersona(persona.id);
      setMade((current) => new Set([...current, persona.id]));
    } catch {
      setError("The agent couldn't be made. Try again.");
    }
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-1.5" aria-label="Divisions">
        <FilterChip
          label={`All ${enabledIn(null)}/${catalog.agents.length}`}
          pressed={division === null}
          onPressedChange={() => setDivision(null)}
        />
        {catalog.divisions.map((entry) => (
          <FilterChip
            key={entry.id}
            label={`${entry.label} ${enabledIn(entry.id)}/${entry.count}`}
            icon={
              <span
                aria-hidden
                className="size-1.5 rounded-full"
                style={{ backgroundColor: entry.color ?? undefined }}
              />
            }
            pressed={division === entry.id}
            onPressedChange={() => setDivision(division === entry.id ? null : entry.id)}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <SearchField
          size="md"
          containerClassName="w-full max-w-xs"
          aria-label="Find a persona"
          placeholder="Find a persona"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {division ? (
          <span className="ml-auto flex gap-1">
            <Button
              disabled={pending}
              onClick={() =>
                void toggle(
                  catalog.agents.filter((agent) => agent.divisionId === division).map((a) => a.id),
                  true,
                )
              }
            >
              Turn on all
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                void toggle(
                  catalog.agents.filter((agent) => agent.divisionId === division).map((a) => a.id),
                  false,
                )
              }
            >
              Turn off all
            </Button>
          </span>
        ) : null}
      </div>
      <div className="grid">
        {shown.map((persona) => {
          const group = divisions.get(persona.divisionId);
          return (
            <div
              key={persona.id}
              className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-charcoal-hover"
            >
              <span className="flex size-9 shrink-0 items-center justify-center">
                {persona.icon ? (
                  <span className="text-base leading-none" aria-hidden>
                    {persona.icon}
                  </span>
                ) : (
                  <Bot className="size-4 text-cream-muted" aria-hidden />
                )}
              </span>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <p className="m-0 flex items-center gap-2 text-sm text-cream">
                  <OverflowFadeText full>{persona.name}</OverflowFadeText>
                  {group ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-micro text-cream-muted">
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full"
                        style={{ backgroundColor: group.color ?? undefined }}
                      />
                      {group.label}
                    </span>
                  ) : null}
                </p>
                <OverflowFadeText as="p" full className="m-0 text-xs text-cream-muted">
                  {persona.description}
                </OverflowFadeText>
              </div>
              <IconButton label={`Read ${persona.name}`} onClick={() => view(persona)}>
                <Eye className="size-4" />
              </IconButton>
              <IconButton
                label={made.has(persona.id) ? "Agent made" : "Make an agent from this"}
                disabled={made.has(persona.id)}
                onClick={() => void make(persona)}
              >
                {made.has(persona.id) ? (
                  <Check className="size-4" />
                ) : (
                  <UserPlus className="size-4" />
                )}
              </IconButton>
              <Switch
                aria-label={`Offer ${persona.name} in the # menu`}
                checked={!disabled.has(persona.id)}
                disabled={pending}
                onCheckedChange={(on) => void toggle([persona.id], on)}
              />
            </div>
          );
        })}
      </div>
      <p className="m-0 text-xs text-cream-muted">
        From{" "}
        <a
          className="underline-offset-2 hover:underline"
          href={catalog.provider.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          {catalog.provider.displayName}
        </a>
        , {catalog.provider.license} license
      </p>
      <Dialog open={Boolean(viewing)} onOpenChange={(open) => !open && setViewing(undefined)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewing?.persona.name}</DialogTitle>
          </DialogHeader>
          {viewing?.prompt ? (
            <pre className="m-0 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-charcoal-card p-3 text-xs text-cream">
              {viewing.prompt.prompt}
            </pre>
          ) : (
            <div className="grid gap-2" aria-hidden="true">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-4/6" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
