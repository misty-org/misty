import { Download, ExternalLink, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  Button,
  CatalogCard,
  CatalogDone,
  CatalogGrid,
  CatalogTile,
  CatalogTileRow,
  CodeBlock,
  CollectionFilters,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ListRowSkeleton,
  MenuItem,
  notify,
  SectionHeading,
  Switch,
  useConfirmDelete,
} from "@/shared/ui";
import {
  canTurnOff,
  categoriesOf,
  categoryLabel,
  failureText,
  marketApi,
  matchItems,
  orderItems,
  pluginNoun,
  takesSources,
  usageLabel,
  type EngineMarket,
  type MarketEngine,
  type MarketItem,
  type MarketSort,
} from "./api";
import { SourcesDialog } from "./MarketplaceSources";
import { PluginDetailsDialog } from "./PluginDetailsDialog";
import { MakerLogo, pluginMaker, sourceLabel } from "./PluginMaker";
import { useEngineMarket } from "./useEngineMarket";

/** Cards drawn at first; Show more adds this many again. */
const PAGE = 60;
/** Category chips past this many fold into All. */
const CATEGORY_CHIPS = 8;
/** The All chip's value among the category chips. */
const allCategories = "all";

/**
 * The plugins an engine's own marketplaces offer, as a catalog: what's installed in a row up top,
 * then every plugin as a card with its maker's logo, where it comes from, and Install. Misty keeps
 * no catalog: the engine lists, installs and removes with its own CLI, and a plugin that brings an
 * app signs in the way that engine does. The page's bar owns the search, the Installed filter, the
 * order and Refresh.
 */
export function EnginePlugins({
  engine,
  name,
  query,
  installedOnly,
  sort,
  sourcesOpen,
  onSourcesOpenChange: setSourcesOpen,
  refreshes,
}: {
  engine: MarketEngine;
  name: string;
  query: string;
  installedOnly: boolean;
  sort: MarketSort;
  sourcesOpen: boolean;
  onSourcesOpenChange(open: boolean): void;
  /** Counts the bar's Refresh presses; each one lists the plugins anew. */
  refreshes: number;
}) {
  const listing = useEngineMarket(engine);
  const [shown, setShown] = useState(PAGE);
  const [category, setCategory] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** The plugin whose details are open, by id, so they follow it as it's installed or turned off. */
  const [opened, setOpened] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    item: MarketItem;
    command: string;
    sha256: string;
  } | null>(null);
  const { confirm, dialog } = useConfirmDelete();

  const { reload } = listing;
  const load = useCallback(async () => {
    await reload();
  }, [reload]);

  useEffect(() => setShown(PAGE), [engine, query, installedOnly, category, sort]);
  useEffect(() => setCategory(null), [engine]);

  // A list that never came shows why; one that came stays on screen while it's listed again.
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
    const found = matchItems(market.items, query, installedOnly);
    return sort === "name"
      ? [...found].sort((a, b) => a.name.localeCompare(b.name))
      : orderItems(found);
  }, [market, query, installedOnly, sort]);
  const categories = useMemo(() => categoriesOf(matches).slice(0, CATEGORY_CHIPS), [matches]);
  const cards = category ? matches.filter((item) => item.category === category) : matches;
  const installed = useMemo(
    () => orderItems(market?.items.filter((item) => item.installed) ?? []),
    [market],
  );

  // A press of the bar's Refresh lists anew, keeping the cards on screen meanwhile.
  useEffect(() => {
    if (refreshes) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshes]);

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

  const toggleFor = (item: MarketItem) =>
    canTurnOff(engine) ? (
      <Switch
        aria-label={`Use ${item.name}`}
        checked={item.enabled}
        disabled={busy !== null}
        onCheckedChange={(on) => void setEnabled(item, on)}
      />
    ) : undefined;

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
        {item.installed ? (
          <MenuItem icon={Trash2} label="Remove" danger onSelect={() => void remove(item)} />
        ) : null}
      </>
    ) : undefined;

  const noun = pluginNoun(engine);
  const canAdd = takesSources(engine);
  const searching = Boolean(query.trim()) || installedOnly;

  return (
    <div className="grid gap-7">
      {!market ? (
        <ListRowSkeleton label={`${name} ${noun}s`} rows={8} lines={2} trailing="button-sm" />
      ) : !market.ready ? (
        <EmptyState
          title={`${name} didn't list its ${noun}s`}
          line={market.error ?? `Check that ${name} is installed and signed in.`}
          action={{ label: "Try again", icon: RefreshCw, onClick: () => void load() }}
        />
      ) : (
        <>
          {installed.length && !searching ? (
            <section className="grid gap-1" aria-label={`Installed in ${name}`}>
              <SectionHeading title={`Installed in ${name}`} count={installed.length} />
              <CatalogTileRow label={`Installed in ${name}`}>
                {installed.map((item) => (
                  <CatalogTile
                    key={item.id}
                    logo={<MakerLogo maker={pluginMaker(item)} name={item.name} size="sm" />}
                    title={item.name}
                    line={item.enabled ? "On" : "Off · kept installed"}
                    control={toggleFor(item)}
                    menu={menuFor(item)}
                    onOpen={() => setOpened(item.id)}
                  />
                ))}
              </CatalogTileRow>
            </section>
          ) : null}

          <section className="grid gap-3" aria-label={`All ${noun}s`}>
            <div className="grid gap-1">
              <SectionHeading
                title={searching ? `Matching ${noun}s` : `All ${noun}s`}
                count={cards.length}
              />
              {categories.length > 1 ? (
                // One bar of chips: past its width they fold into ⋯, the chosen one last.
                <CollectionFilters
                  options={[
                    { value: allCategories, label: "All" },
                    ...categories.map(([value, count]) => ({
                      value,
                      label: `${categoryLabel(value)} ${count}`,
                    })),
                  ]}
                  value={category ?? allCategories}
                  onChange={(value) => setCategory(value === allCategories ? null : value)}
                />
              ) : null}
            </div>

            {cards.length === 0 ? (
              <EmptyState
                title={
                  searching || category ? `No ${noun}s found` : `${name} offers no ${noun}s yet`
                }
                line={
                  searching || category
                    ? canAdd
                      ? "Try other words, or add a marketplace."
                      : "Try other words."
                    : canAdd
                      ? `Add a marketplace to see its ${noun}s here.`
                      : `${name} lists none right now.`
                }
                action={
                  canAdd
                    ? {
                        label: "Add a marketplace",
                        icon: Plus,
                        onClick: () => setSourcesOpen(true),
                      }
                    : undefined
                }
              />
            ) : (
              <CatalogGrid label={`${name} ${noun}s`}>
                {cards.slice(0, shown).map((item) => {
                  const maker = pluginMaker(item);
                  const link = item.link;
                  return (
                    <CatalogCard
                      key={item.id}
                      logo={<MakerLogo maker={maker} name={item.name} />}
                      title={item.name}
                      maker={maker.name}
                      description={item.description}
                      source={
                        link
                          ? {
                              label: sourceLabel(link),
                              href: link,
                              onOpen: () => openExternalLink(link),
                            }
                          : undefined
                      }
                      tag={categoryLabel(item.category)}
                      detail={usageLabel(item)}
                      action={
                        item.installed ? (
                          <CatalogDone />
                        ) : (
                          <Button
                            icon={Download}
                            loading={busy === item.id}
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
                })}
              </CatalogGrid>
            )}
            {cards.length > shown ? (
              <Button
                variant="quiet"
                className="justify-self-start"
                onClick={() => setShown((count) => count + PAGE)}
              >
                Show more
              </Button>
            ) : null}
          </section>
        </>
      )}

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
      <PluginDetailsDialog
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
    </div>
  );
}
