import { Download, ExternalLink, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  Button,
  CodeBlock,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ListRow,
  ListRowSkeleton,
  MenuItem,
  notify,
  useConfirmDelete,
} from "@/shared/ui";
import {
  failureText,
  itemDetails,
  marketApi,
  matchItems,
  orderItems,
  type EngineMarket,
  type MarketEngine,
  pluginNoun,
  takesSources,
  type MarketItem,
} from "./api";
import { SourcesDialog } from "./MarketplaceSources";

/** Rows drawn at first; Show more adds this many again. */
const PAGE = 100;

/**
 * The plugins an engine's own marketplaces offer. Misty keeps no catalog: the engine lists,
 * installs and removes with its own CLI, and a plugin that brings an app signs in the way that
 * engine does. The page's bar owns the search, the Installed filter, Marketplaces and Refresh.
 */
export function EnginePlugins({
  engine,
  name,
  query,
  installedOnly,
  sourcesOpen,
  onSourcesOpenChange: setSourcesOpen,
  refreshes,
}: {
  engine: MarketEngine;
  name: string;
  query: string;
  installedOnly: boolean;
  sourcesOpen: boolean;
  onSourcesOpenChange(open: boolean): void;
  /** Counts the bar's Refresh presses; each one lists the plugins anew. */
  refreshes: number;
}) {
  const [markets, setMarkets] = useState<Partial<Record<MarketEngine, EngineMarket>>>({});
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<{
    item: MarketItem;
    command: string;
    sha256: string;
  } | null>(null);
  const { confirm, dialog } = useConfirmDelete();

  const load = useCallback(async (which: MarketEngine) => {
    try {
      const market = await marketApi.list(which);
      setMarkets((current) => ({ ...current, [which]: market }));
    } catch (reason) {
      setMarkets((current) => ({
        ...current,
        [which]: {
          engine: which,
          ready: false,
          items: [],
          sources: [],
          error: failureText(reason, "The plugins couldn't be listed."),
        },
      }));
    }
  }, []);

  useEffect(() => {
    if (!markets[engine]) void load(engine);
  }, [engine, markets, load]);
  useEffect(() => setShown(PAGE), [engine, query, installedOnly]);

  const market = markets[engine];
  const matches = useMemo(
    () => (market ? orderItems(matchItems(market.items, query, installedOnly)) : []),
    [market, query, installedOnly],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(engine);
    setRefreshing(false);
  }, [engine, load]);
  // Only a press of the bar's Refresh lists anew; switching engines shows what's loaded.
  useEffect(() => {
    if (refreshes) void refresh();
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
      await load(engine);
      notify({ message: `${item.name} is installed in ${name}.` });
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
          await load(engine);
        } catch (reason) {
          notify({
            message: failureText(reason, `${item.name} couldn't be removed.`),
            tone: "error",
          });
        }
      },
    });
  };

  const noun = pluginNoun(engine);
  const canAdd = takesSources(engine);
  return (
    <div className="grid gap-3">
      {!market || refreshing ? (
        <ListRowSkeleton label={`${name} ${noun}s`} rows={10} lines={2} />
      ) : !market.ready ? (
        <EmptyState
          title={`${name} didn't list its ${noun}s`}
          line={market.error ?? `Check that ${name} is installed and signed in.`}
          action={{ label: "Try again", icon: RefreshCw, onClick: () => void refresh() }}
        />
      ) : matches.length === 0 ? (
        <EmptyState
          title={query || installedOnly ? `No ${noun}s found` : `${name} offers no ${noun}s yet`}
          line={
            query || installedOnly
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
        <ul className="grid">
          {matches.slice(0, shown).map((item) => (
            <li key={item.id} className="list-none">
              <ListRow
                label={item.name}
                description={itemDetails(item)}
                state={item.installed ? { kind: "done", label: "Installed" } : { kind: "none" }}
                trailing={
                  item.installed ? undefined : (
                    <Button
                      size="sm"
                      icon={Download}
                      loading={busy === item.id}
                      disabled={busy !== null}
                      onClick={() => void install(item)}
                    >
                      Install
                    </Button>
                  )
                }
                menu={
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
                        <MenuItem
                          icon={Trash2}
                          label="Remove"
                          danger
                          onSelect={() => void remove(item)}
                        />
                      ) : null}
                    </>
                  ) : undefined
                }
              />
            </li>
          ))}
          {matches.length > shown ? (
            <li className="list-none pt-2">
              <Button variant="quiet" onClick={() => setShown((count) => count + PAGE)}>
                Show more
              </Button>
            </li>
          ) : null}
        </ul>
      )}

      {market?.ready && canAdd ? (
        <SourcesDialog
          open={sourcesOpen}
          onOpenChange={setSourcesOpen}
          engine={engine}
          name={name}
          market={market}
          onChanged={() => load(engine)}
        />
      ) : null}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Install {pending?.item.name}?</DialogTitle>
            <DialogDescription>
              Its marketplace fetches it by running this command on your computer.
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
      {dialog}
    </div>
  );
}
