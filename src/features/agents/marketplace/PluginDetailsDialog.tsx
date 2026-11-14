import { Download, ExternalLink, Trash2 } from "lucide-react";
import { useCachedResource } from "@/api/cache/cached-resource";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  Button,
  CatalogDone,
  CatalogNames,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  InlineLink,
  PropertyList,
  SectionHeading,
  Skeleton,
  Switch,
  Text,
} from "@/shared/ui";
import {
  canTurnOff,
  categoryLabel,
  marketApi,
  usageLabel,
  type MarketEngine,
  type MarketItem,
  type PluginContents,
} from "./api";
import { MakerLogo, pluginMaker, sourceLabel } from "./PluginMaker";

const kinds: { key: keyof Omit<PluginContents, "known" | "version">; title: string }[] = [
  { key: "skills", title: "Skills" },
  { key: "commands", title: "Commands" },
  { key: "agents", title: "Agents" },
  { key: "hooks", title: "Hooks" },
  { key: "mcpServers", title: "MCP servers" },
];

/**
 * One plugin up close: what it does, what it adds to the engine (its skills, commands, agents,
 * hooks and MCP servers, read from its folder), where it comes from, and the one thing to do with
 * it: Install, or for an installed one, turn it on or off and Remove.
 */
export function PluginDetailsDialog({
  engine,
  engineName,
  item,
  busy,
  onClose,
  onInstall,
  onRemove,
  onEnabledChange,
}: {
  engine: MarketEngine;
  engineName: string;
  /** The plugin shown; null closes the dialog. */
  item: MarketItem | null;
  /** The plugin being installed or changed, if any. */
  busy: string | null;
  onClose(): void;
  onInstall(item: MarketItem): void;
  onRemove(item: MarketItem): void;
  onEnabledChange(item: MarketItem, enabled: boolean): void;
}) {
  // Read once per plugin and kept for the session: a plugin's folder changes only when it updates.
  const contents = useCachedResource(
    item ? `engines/market-details:${engine}:${item.id}:${item.installed}` : null,
    () => marketApi.details(engine, item?.id ?? ""),
  );
  const maker = item ? pluginMaker(item) : {};
  const link = item?.link ?? null;
  const found = contents.data;
  const added = found ? kinds.filter((kind) => found[kind.key].length) : [];

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg" layout="scroll">
        {item ? (
          <>
            <DialogHeader>
              <div className="flex min-w-0 items-start gap-3">
                <MakerLogo maker={maker} name={item.name} />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <DialogTitle>{item.name}</DialogTitle>
                  <DialogDescription>
                    {[
                      maker.name ? `by ${maker.name}` : "",
                      categoryLabel(item.category),
                      usageLabel(item),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </DialogDescription>
                </div>
                {link ? (
                  <IconButton label="Open its page" onClick={() => openExternalLink(link)}>
                    <ExternalLink />
                  </IconButton>
                ) : null}
              </div>
            </DialogHeader>
            <DialogBody className="grid gap-6">
              {item.description ? (
                <Text as="p" size="body" tone="default" wrap className="m-0">
                  {item.description}
                </Text>
              ) : null}

              <section className="grid gap-2" aria-label={`What it adds to ${engineName}`}>
                <SectionHeading title={`What it adds to ${engineName}`} as="h3" />
                {contents.loading ? (
                  <div aria-hidden="true" className="grid gap-2">
                    <Skeleton className="h-6 w-3/4 rounded-md" />
                    <Skeleton className="h-6 w-1/2 rounded-md" />
                  </div>
                ) : !found?.known ? (
                  <Text as="p" size="meta" tone="muted" wrap className="m-0">
                    {engine === "claude"
                      ? "Its skills, commands and servers show here once it's installed."
                      : `${engineName} doesn't list what its plugins add.`}
                  </Text>
                ) : added.length === 0 ? (
                  <Text as="p" size="meta" tone="muted" wrap className="m-0">
                    It adds no skills, commands, agents, hooks or servers of its own.
                  </Text>
                ) : (
                  <dl className="m-0 grid gap-3">
                    {added.map((kind) => (
                      <div key={kind.key} className="grid gap-1.5">
                        <Text as="dt" size="meta" tone="muted">
                          {kind.title} · {found[kind.key].length}
                        </Text>
                        <dd className="m-0">
                          <CatalogNames names={found[kind.key]} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {found?.hooks.length ? (
                  <Text as="p" size="meta" tone="muted" wrap className="m-0">
                    Hooks run on their own, without asking, with {engineName}'s permissions. Install
                    plugins only from people you trust.
                  </Text>
                ) : null}
              </section>

              <PropertyList
                label="About"
                items={[
                  { label: "Marketplace", value: item.marketplace },
                  ...(found?.version ? [{ label: "Version", value: found.version }] : []),
                  ...(link
                    ? [
                        {
                          label: "Source",
                          value: (
                            <InlineLink onClick={() => openExternalLink(link)}>
                              {sourceLabel(link)}
                            </InlineLink>
                          ),
                          full: sourceLabel(link),
                        },
                      ]
                    : []),
                ]}
              />
            </DialogBody>
            <DialogFooter>
              {item.installed ? (
                <>
                  <Button
                    variant="danger"
                    icon={Trash2}
                    disabled={busy !== null}
                    onClick={() => onRemove(item)}
                  >
                    Remove
                  </Button>
                  <span className="flex-1" />
                  {canTurnOff(engine) ? (
                    <label className="flex items-center gap-2">
                      <Text size="control" tone="default">
                        {item.enabled ? "On" : "Off"}
                      </Text>
                      <Switch
                        aria-label={`Use ${item.name}`}
                        checked={item.enabled}
                        disabled={busy !== null}
                        onCheckedChange={(on) => onEnabledChange(item, on)}
                      />
                    </label>
                  ) : (
                    <CatalogDone />
                  )}
                </>
              ) : (
                <>
                  <Button variant="quiet" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    icon={Download}
                    loading={busy === item.id}
                    disabled={busy !== null}
                    onClick={() => onInstall(item)}
                  >
                    {`Install in ${engineName}`}
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
