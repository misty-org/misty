// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
/**
 * Settings › Behavior › Personas: the bundled agency-agents catalog. Each persona can be switched
 * off for the `#` menu, read in full, or made into one of the person's own agents. Divisions
 * filter the list and switch a whole division at once.
 */
import { Check, Eye, UserPlus } from "lucide-react";
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
  SkeletonControl,
  Surface,
  Switch,
  useNotice,
  OverflowFadeText,
  Text,
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

const chipWidths = ["w-20", "w-28", "w-24", "w-32", "w-24", "w-28"];
const nameWidths = ["w-40", "w-32", "w-44", "w-36"];
const lineWidths = ["w-72", "w-64", "w-80", "w-56"];

/**
 * The catalog's first paint, in its own shape: the division chips, the search field, then persona
 * rows with their mark, name and line, the two actions and the switch.
 */
function CatalogSkeleton() {
  return (
    <div role="status" aria-label="Personas" aria-busy="true" className="grid gap-3">
      <span className="sr-only">Personas</span>
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden" aria-hidden="true">
        {chipWidths.map((width, index) => (
          <Skeleton key={index} className={`h-8 shrink-0 rounded-md ${width}`} />
        ))}
      </div>
      <div className="flex items-center gap-2" aria-hidden="true">
        <Skeleton className="h-9 w-full max-w-xs rounded-lg" />
      </div>
      <div className="grid" aria-hidden="true">
        {Array.from({ length: 8 }, (_, row) => (
          <div key={row} className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span className="flex size-9 shrink-0 items-center justify-center">
              <Skeleton className="size-5 rounded-md" />
            </span>
            <div className="grid min-w-0 flex-1 gap-0.5">
              <div className="flex h-5 items-center">
                <Skeleton className={`h-3.5 ${nameWidths[row % nameWidths.length]}`} />
              </div>
              <div className="flex h-4 items-center">
                <Skeleton className={`h-3 max-w-full ${lineWidths[row % lineWidths.length]}`} />
              </div>
            </div>
            <SkeletonControl kind="icon" />
            <SkeletonControl kind="icon" />
            <SkeletonControl kind="switch" />
          </div>
        ))}
      </div>
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
      <div className="flex min-w-0 items-center gap-1.5" aria-label="Divisions">
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
            <div key={persona.id} className="group flex items-center gap-3 rounded-lg px-2 py-2">
              <span className="flex size-9 shrink-0 items-center justify-center">
                {persona.icon ? (
                  <span className="text-base leading-none" aria-hidden>
                    {persona.icon}
                  </span>
                ) : (
                  <Text size="control" weight="semibold" tone="muted" aria-hidden>
                    {(persona.name.trim()[0] ?? "?").toUpperCase()}
                  </Text>
                )}
              </span>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <Text bare as="p" tone="default" className="m-0 flex items-center gap-2 text-sm">
                  <OverflowFadeText full>{persona.name}</OverflowFadeText>
                  {group ? (
                    <Text
                      bare
                      tone="muted"
                      className="inline-flex shrink-0 items-center gap-1 text-micro"
                    >
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full"
                        style={{ backgroundColor: group.color ?? undefined }}
                      />
                      {group.label}
                    </Text>
                  ) : null}
                </Text>
                <Text as="p" full tone="muted" className="m-0 text-xs">
                  {persona.description}
                </Text>
              </div>
              <IconButton label={`Read ${persona.name}`} onClick={() => view(persona)}>
                <Eye />
              </IconButton>
              <IconButton
                label={made.has(persona.id) ? "Agent made" : "Make an agent from this"}
                disabled={made.has(persona.id)}
                onClick={() => void make(persona)}
              >
                {made.has(persona.id) ? <Check /> : <UserPlus />}
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
      <Text bare as="p" tone="muted" className="m-0 text-xs">
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
      </Text>
      <Dialog open={Boolean(viewing)} onOpenChange={(open) => !open && setViewing(undefined)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewing?.persona.name}</DialogTitle>
          </DialogHeader>
          {viewing?.prompt ? (
            <Surface
              as="pre"
              tone="card"
              radius="lg"
              className="m-0 max-h-[60vh] overflow-auto whitespace-pre-wrap p-3 text-xs"
            >
              <Text bare tone="default">
                {viewing.prompt.prompt}
              </Text>
            </Surface>
          ) : (
            <Skeleton className="h-64 rounded-lg" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
