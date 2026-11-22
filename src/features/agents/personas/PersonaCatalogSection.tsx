// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
/**
 * Explore › Templates: the bundled agency-agents personas, as shelves. The person sees them as
 * templates: ready-made instructions to start an agent from. Each can be made into one of the
 * person's own agents, read in full, and offered or not in the composer's `#` menu;
 * a category can be offered or withdrawn at once. Personas work with every engine: their prompt
 * is added to whichever engine's run names them.
 */
import { BookOpen, MoreHorizontal, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Button,
  CatalogDone,
  BackButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  InlineLink,
  MenuCheckItem,
  MenuItem,
  PersonaLogo,
  Shelf,
  ShelfItem,
  ShelfSkeleton,
  Skeleton,
  StoreDetail,
  StoreDetailSection,
  Surface,
  Text,
  personaTone,
  useNotice,
} from "@misty/ui";
import { openExternalLink } from "@/shared/platform/openExternalLink";
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
import { personaGlyph } from "./personaGlyph";

/** How many each category's shelf shows before See all, when every category is listed. */
const perShelf = 4;

function Logo({ persona }: { persona: CatalogPersona }) {
  return <PersonaLogo icon={personaGlyph(persona)} color={personaTone(persona.id)} size="tile" />;
}

export function PersonaCatalogSection({
  query = "",
  picks,
  title = "Templates",
  onSeeAll,
}: {
  query?: string;
  /** On All: only these personas, in this order, on one shelf. */
  picks?: readonly string[];
  /** The shelf's title when `picks` is given. */
  title?: string;
  /** On All: See all, which opens the Agents section. */
  onSeeAll?: () => void;
}) {
  const [catalog, setCatalog] = useState<CatalogView>();
  const [disabled, setDisabled] = useState<ReadonlySet<string>>(new Set());
  const [division, setDivision] = useState("all");
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
      () => live && setError("The templates couldn't load."),
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
        !words ||
        agent.name.toLowerCase().includes(words) ||
        agent.description.toLowerCase().includes(words),
    );
  }, [catalog, query]);

  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });

  if (!catalog) return error ? null : <ShelfSkeleton label="Templates" />;

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
      () => setError("This template couldn't be read."),
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

  const action = (persona: CatalogPersona, size: "sm" | "lg" = "sm") =>
    made.has(persona.id) ? (
      <CatalogDone label="Agent made" />
    ) : (
      <Button
        size={size}
        variant={size === "lg" ? "get-filled" : "get"}
        onClick={() => void make(persona)}
      >
        Make agent
      </Button>
    );

  const menu = (persona: CatalogPersona) => (
    <>
      <MenuItem icon={BookOpen} label="Read" onSelect={() => view(persona)} />
      {made.has(persona.id) ? null : (
        <MenuItem icon={UserPlus} label="Make an agent" onSelect={() => void make(persona)} />
      )}
      <MenuCheckItem
        label="Offer in the # menu"
        checked={!disabled.has(persona.id)}
        disabled={pending}
        onCheckedChange={(on) => void toggle([persona.id], on)}
      />
    </>
  );

  const item = (persona: CatalogPersona) => (
    <ShelfItem
      key={persona.id}
      logo={<Logo persona={persona} />}
      title={persona.name}
      line={persona.description}
      action={action(persona)}
      menu={menu(persona)}
      onOpen={() => view(persona)}
    />
  );

  const divisions = catalog.divisions.toSorted((a, b) => a.order - b.order);
  const label = (id: string) => divisions.find((entry) => entry.id === id)?.label ?? id;
  const inDivision = (id: string) => shown.filter((persona) => persona.divisionId === id);

  /** The ⋯ beside a category's title: offer or withdraw all of it at once. */
  const divisionMenu = (id: string) => {
    const ids = catalog.agents.filter((agent) => agent.divisionId === id).map((a) => a.id);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={`${label(id)} actions`} disabled={pending}>
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <MenuItem label="Offer all in the # menu" onSelect={() => void toggle(ids, true)} />
          <MenuItem label="Remove all from the # menu" onSelect={() => void toggle(ids, false)} />
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  let shelves: ReactNode;
  if (picks) {
    const chosen = picks
      .map((id) => shown.find((persona) => persona.id.endsWith(id)))
      .filter((persona): persona is CatalogPersona => Boolean(persona));
    shelves = chosen.length ? (
      <Shelf
        title={title}
        action={
          onSeeAll ? (
            <Button variant="quiet" size="sm" onClick={onSeeAll}>
              See all
            </Button>
          ) : undefined
        }
      >
        {chosen.map(item)}
      </Shelf>
    ) : null;
  } else if (division === "all") {
    shelves = divisions.map((entry) => {
      const members = inDivision(entry.id);
      if (!members.length) return null;
      return (
        <Shelf
          key={entry.id}
          title={entry.label}
          action={
            members.length > perShelf && !query.trim() ? (
              <Button variant="quiet" size="sm" onClick={() => setDivision(entry.id)}>
                See all
              </Button>
            ) : undefined
          }
        >
          {(query.trim() ? members : members.slice(0, perShelf)).map(item)}
        </Shelf>
      );
    });
  } else {
    const members = inDivision(division);
    shelves = members.length ? (
      <Shelf title={label(division)} action={divisionMenu(division)}>
        {members.map(item)}
      </Shelf>
    ) : null;
  }

  return (
    <>
      {!picks && division !== "all" ? (
        <BackButton className="justify-self-start" onClick={() => setDivision("all")}>
          All templates
        </BackButton>
      ) : null}
      {shelves}
      {query.trim() && !shown.length && !picks ? (
        <EmptyState inline title="No agents found" line="Try another word or category." />
      ) : null}
      {picks ? null : (
        <Text size="meta" tone="muted">
          From{" "}
          <InlineLink onClick={() => void openExternalLink(catalog.provider.sourceUrl)}>
            {catalog.provider.displayName}
          </InlineLink>
          , {catalog.provider.license} license
        </Text>
      )}
      {viewing ? (
        <StoreDetail
          open
          onOpenChange={(open) => !open && setViewing(undefined)}
          logo={<Logo persona={viewing.persona} />}
          title={viewing.persona.name}
          line={viewing.persona.description}
          action={action(viewing.persona, "lg")}
          facts={[
            { label: "Category", value: label(viewing.persona.divisionId) },
            { label: "From", value: catalog.provider.displayName },
            { label: "License", value: catalog.provider.license },
            {
              label: "# menu",
              value: disabled.has(viewing.persona.id) ? "Off" : "On",
            },
          ]}
        >
          <StoreDetailSection title="Instructions">
            {viewing.prompt ? (
              <Surface tone="card" radius="lg" className="max-h-96 overflow-auto p-3">
                <Text as="p" size="meta" wrap className="m-0 whitespace-pre-wrap">
                  {viewing.prompt.prompt}
                </Text>
              </Surface>
            ) : (
              <Skeleton className="h-64 rounded-lg" />
            )}
          </StoreDetailSection>
        </StoreDetail>
      ) : null}
    </>
  );
}
