import {
  ArrowDownAZ,
  ExternalLink,
  Flame,
  FolderGit2,
  Plus,
  Power,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { openExternalLink } from "@/shared/platform/open_external_link";
import {
  Button,
  CatalogDone,
  CodeBlock,
  CollectionControls,
  CollectionFilterMenu,
  CollectionSortMenu,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  IconButton,
  MenuItem,
  notify,
  ShelfItem,
  useConfirmDelete,
} from "@misty/ui";
import { openAgentsHub } from "../hub/agents_hub_store";
import {
  canTurnOff,
  categoriesOf,
  categoryLabel,
  failureText,
  hasPlugins,
  marketApi,
  matchItems,
  orderItems,
  pluginNoun,
  takesSources,
  unaddedSuggestions,
  type EngineMarket,
  type MarketEngine,
  type MarketItem,
  type MarketSort,
} from "./api";
import { EnginePicker, MarketShelf, MarketShelvesSkeleton, MarketSkeleton } from "./MarketShelf";
import { setMarketSort, useMarketEngines, useMarketView } from "./market_view";
import { SourcesDialog } from "./MarketplaceSources";
import { MakerTile, pluginMaker } from "./PluginMaker";
import { PluginStoreDetail } from "./PluginStoreDetail";
import { useEngineMarket } from "./use_engine_market";

const sortOptions = [
  { value: "popular", label: "Most installed", icon: Flame },
  { value: "name", label: "Name", icon: ArrowDownAZ },
] as const satisfies readonly { value: MarketSort; label: string; icon: typeof Flame }[];

const allCategories = "all";

export function PluginsSection({ query }: { query: string }) {
  const { engines, engine, name, error, reload, pick } = useMarketEngines("plugins", hasPlugins);
  if (!engines)
    return error ? (
      <ErrorState
        inline
        title="The engines couldn't be listed"
        line={error}
        action={{ label: "Try again", icon: RefreshCw, onClick: reload }}
      />
    ) : (
      <MarketSkeleton label="Plugins" />
    );
  if (!engines.length)
    return (
      <EmptyState
        inline
        title="Nothing takes plugins yet"
        line="Install an engine that has plugins, and they show here."
        action={{ label: "Open CLIs", onClick: () => openAgentsHub("clis") }}
      />
    );
  return (
    <EnginePluginShelves
      key={engine}
      engine={engine as MarketEngine}
      name={name}
      query={query}
      picker={<EnginePicker engines={engines} engine={engine} onPick={pick} />}
    />
  );
}

function EnginePluginShelves({
  engine,
  name,
  query,
  picker,
}: {
  engine: MarketEngine;
  name: string;
  query: string;
  picker: ReactNode;
}) {
  const listing = useEngineMarket(engine);
  const sort = useMarketView((state) => state.value.sort);
  const [category, setCategory] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    item: MarketItem;
    command: string;
    sha256: string;
  } | null>(null);
  const { confirm, dialog } = useConfirmDelete();
  const load = async () => {
    await listing.reload();
  };

  const market: EngineMarket | undefined = useMemo(
    () =>
      listing.data ??
      (listing.error
        ? {
            engine,
            ready: false,
            items: [],
            sources: [],
            error: failureText(listing.error, "The plugins couldn't be listed."),
          }
        : undefined),
    [listing.data, listing.error, engine],
  );
  const matches = useMemo(() => {
    if (!market) return [];
    const found = matchItems(market.items, query, false);
    return sort === "name"
      ? [...found].sort((a, b) => a.name.localeCompare(b.name))
      : orderItems(found);
  }, [market, query, sort]);
  const categories = useMemo(() => categoriesOf(matches), [matches]);
  const shown = useMemo(
    () => (category ? matches.filter((item) => item.category === category) : matches),
    [matches, category],
  );
  const installed = shown.filter((item) => item.installed);
  const shelves = useMemo(() => {
    const groups = new Map<string, MarketItem[]>();
    for (const item of shown)
      groups.set(item.marketplace, [...(groups.get(item.marketplace) ?? []), item]);
    return [...groups];
  }, [shown]);

  const noun = pluginNoun(engine);
  const canAdd = takesSources(engine);
  const suggestions = market?.ready && canAdd ? unaddedSuggestions(engine, market.sources) : [];
  const filtered = Boolean(query.trim()) || category !== null;

  const install = async (item: MarketItem, accept?: string) => {
    setBusy(item.id);
    try {
      const outcome = await marketApi.install(engine, item.id, accept);
      if (outcome.result === "confirmCommand") {
        setPending({ item, ...outcome.command });
        return;
      }
      await load();
      notify({ message: `${item.name} is installed in ${name}. New chats can use it.` });
    } catch (reason) {
      notify({
        message: failureText(reason, `${item.name} couldn't be installed.`),
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (item: MarketItem) => {
    await confirm({
      title: `Remove ${item.name}?`,
      what: `${name} stops using it. You can install it again from here.`,
      confirmLabel: "Remove",
      onConfirm: async () => {
        try {
          await marketApi.remove(engine, item.id);
          await load();
        } catch (reason) {
          notify({
            message: failureText(reason, `${item.name} couldn't be removed.`),
            tone: "error",
          });
        }
      },
    });
  };

  const setEnabled = async (item: MarketItem, enabled: boolean) => {
    setBusy(item.id);
    try {
      await marketApi.setEnabled(engine, item.id, enabled);
      await load();
    } catch (reason) {
      notify({
        message: failureText(reason, `${item.name} couldn't be turned ${enabled ? "on" : "off"}.`),
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  const addSource = async (source: string, label: string) => {
    setAdding(source);
    try {
      await marketApi.addSource(engine, source);
      await load();
      notify({ message: `${label} is added. Its ${noun}s are on the shelves.` });
    } catch (reason) {
      notify({ message: failureText(reason, `${label} couldn't be added.`), tone: "error" });
    } finally {
      setAdding(null);
    }
  };

  const menuFor = (item: MarketItem) =>
    item.link || item.installed ? (
      <>
        {item.link ? (
          <MenuItem
            icon={ExternalLink}
            label="Open its page"
            onSelect={() => openExternalLink(item.link ?? "")}
          />
        ) : null}
        {item.installed && canTurnOff(engine) ? (
          <MenuItem
            icon={Power}
            label={item.enabled ? "Turn off" : "Turn on"}
            disabled={busy !== null}
            onSelect={() => void setEnabled(item, !item.enabled)}
          />
        ) : null}
        {item.installed ? (
          <MenuItem icon={Trash2} label="Remove" danger onSelect={() => void remove(item)} />
        ) : null}
      </>
    ) : undefined;

  const itemOf = (item: MarketItem) => (
    <ShelfItem
      key={item.id}
      logo={<MakerTile maker={pluginMaker(item)} name={item.name} />}
      title={item.name}
      line={item.installed && !item.enabled ? "Installed but turned off" : item.description}
      action={
        item.installed ? (
          <CatalogDone />
        ) : (
          <Button
            variant="get"
            size="sm"
            disabled={busy !== null}
            aria-label={`Install ${item.name}`}
            onClick={() => void install(item)}
          >
            {item.signIn === "on_install" ? "Install and sign in" : "Install"}
          </Button>
        )
      }
      menu={menuFor(item)}
      onOpen={() => setOpened(item.id)}
    />
  );

  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        {picker}
        <div className="min-w-0 flex-1">
          <CollectionControls
            filterControl={
              categories.length ? (
                <CollectionFilterMenu
                  label="Filter"
                  active={category !== null}
                  onReset={() => setCategory(null)}
                  groups={[
                    {
                      label: "Category",
                      value: category ?? allCategories,
                      options: [
                        { value: allCategories, label: "All" },
                        ...categories.map(([value]) => ({ value, label: categoryLabel(value) })),
                      ],
                      onChange: (value) => setCategory(value === allCategories ? null : value),
                    },
                  ]}
                />
              ) : undefined
            }
            utilities={
              <>
                <CollectionSortMenu value={sort} options={sortOptions} onChange={setMarketSort} />
                <IconButton label={`Refresh ${noun}s`} onClick={() => void load()}>
                  <RefreshCw />
                </IconButton>
                {canAdd ? (
                  <IconButton
                    label="Manage marketplaces"
                    disabled={!market?.ready}
                    onClick={() => setSourcesOpen(true)}
                  >
                    <FolderGit2 />
                  </IconButton>
                ) : null}
              </>
            }
          />
        </div>
      </div>

      {!market ? (
        <MarketShelvesSkeleton label={`${name} ${noun}s`} />
      ) : !market.ready ? (
        <ErrorState
          inline
          title={`${name} didn't list its ${noun}s`}
          line={market.error ?? `Check that ${name} is installed and signed in.`}
          action={{ label: "Try again", icon: RefreshCw, onClick: () => void load() }}
        />
      ) : shown.length === 0 ? (
        <EmptyState
          inline
          title={filtered ? `No ${noun}s found` : `${name} offers no ${noun}s yet`}
          line={
            filtered
              ? canAdd
                ? "Try other words, or add a marketplace."
                : "Try other words."
              : canAdd
                ? `Add a marketplace to see its ${noun}s here.`
                : `${name} lists none right now.`
          }
          action={
            canAdd
              ? { label: "Add a marketplace", icon: Plus, onClick: () => setSourcesOpen(true) }
              : undefined
          }
        />
      ) : (
        <>
          {installed.length ? (
            <MarketShelf
              key={`installed:${category}:${query}`}
              title={`Installed in ${name}`}
              items={installed}
              render={itemOf}
            />
          ) : null}
          {shelves.map(([marketplace, items]) => (
            <MarketShelf
              key={`${marketplace}:${category}:${query}`}
              title={marketplace}
              items={items}
              render={itemOf}
            />
          ))}
        </>
      )}

      {suggestions.length && !filtered ? (
        <MarketShelf
          title="Suggested marketplaces"
          items={suggestions}
          render={(suggestion) => {
            const link = `https://github.com/${suggestion.source}`;
            return (
              <ShelfItem
                key={suggestion.source}
                logo={<MakerTile maker={pluginMaker({ link })} name={suggestion.name} />}
                title={suggestion.name}
                line={suggestion.line}
                action={
                  <Button
                    variant="get"
                    size="sm"
                    aria-label={`Add ${suggestion.name}`}
                    disabled={adding !== null}
                    onClick={() => void addSource(suggestion.source, suggestion.name)}
                  >
                    Add
                  </Button>
                }
                menu={
                  <MenuItem
                    icon={ExternalLink}
                    label="Open on GitHub"
                    onSelect={() => openExternalLink(link)}
                  />
                }
                onOpen={() => openExternalLink(link)}
              />
            );
          }}
        />
      ) : null}

      {market?.ready && canAdd ? (
        <SourcesDialog
          open={sourcesOpen}
          onOpenChange={setSourcesOpen}
          engine={engine}
          name={name}
          market={market}
          onChanged={load}
        />
      ) : null}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Install {pending?.item.name}?</DialogTitle>
            <DialogDescription>
              Its marketplace fetches it by running this command on your computer. Check it before
              you go on.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <CodeBlock code={pending?.command ?? ""} wrap />
          </DialogBody>
          <DialogFooter>
            <Button variant="quiet" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const current = pending;
                setPending(null);
                if (current) void install(current.item, current.sha256);
              }}
            >
              Run and install
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PluginStoreDetail
        engine={engine}
        engineName={name}
        item={market?.items.find((item) => item.id === opened) ?? null}
        busy={busy}
        onClose={() => setOpened(null)}
        onInstall={(item) => void install(item)}
        onRemove={(item) => void remove(item)}
        onEnabledChange={(item, on) => void setEnabled(item, on)}
      />
      {dialog}
    </>
  );
}
