import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { MarketplaceCatalogIcon } from "./MarketplaceCatalogIcon";
import { pluginStatus, statusBadgeVariant } from "./helpers";
import {
  MarketplacePrimaryAction,
  type MarketplaceActionHandlers,
} from "./MarketplacePrimaryAction";
import type { MarketplaceEntry } from "./types";

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="gap-2 rounded-lg" size="sm">
      <div className="px-6">
        <p className="text-xs font-medium text-cream">{title}</p>
        <div className="mt-2 text-xs text-cream-muted">{children}</div>
      </div>
    </Card>
  );
}

export function MarketplaceDetailDialog({
  plugin,
  busy,
  onClose,
  onToggle,
  onUninstall,
  ...actions
}: MarketplaceActionHandlers & {
  plugin: MarketplaceEntry | undefined;
  busy: boolean;
  onClose: () => void;
  onUninstall?: (plugin: MarketplaceEntry) => void;
}) {
  return (
    <Dialog onOpenChange={(open) => (open ? undefined : onClose())} open={Boolean(plugin)}>
      <DialogContent className="max-w-2xl">
        {plugin ? (
          <>
            <DialogHeader className="pr-8">
              <div className="flex items-center gap-3">
                <MarketplaceCatalogIcon
                  className="size-10 shrink-0"
                  logoSrc={plugin.logoSrc}
                  pluginId={plugin.id}
                  pluginName={plugin.name}
                  roundedClassName="rounded-lg"
                  textClassName="text-xs font-semibold text-cream-bright"
                />
                <div className="min-w-0">
                  <DialogTitle className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{plugin.name}</span>
                    <Badge className="shrink-0 text-[10px]" variant={statusBadgeVariant(plugin)}>
                      {pluginStatus(plugin)}
                    </Badge>
                  </DialogTitle>
                  <DialogDescription className="mt-1 truncate text-xs">
                    {plugin.author || "Misty"} · v{plugin.version}
                    {plugin.verified ? " · verified" : ""}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="grid gap-2">
              <DetailSection title="Overview">
                <p className="leading-5">{plugin.overview || "No overview yet."}</p>
              </DetailSection>

              <div className="grid gap-2 sm:grid-cols-2">
                <DetailSection title="Capabilities">
                  <ul className="grid gap-1.5">
                    {plugin.capabilities.map((item) => (
                      <li className="flex gap-1.5" key={item}>
                        <CheckCircle2 className="mt-0.5 shrink-0 text-sage-fg" size={13} />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </DetailSection>

                <DetailSection title="Permissions">
                  <ul className="grid gap-1.5">
                    {plugin.permissions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </DetailSection>

                <DetailSection title="Placement">
                  <dl className="grid grid-cols-[88px_1fr] gap-x-2 gap-y-1.5">
                    <dt>Appears in</dt>
                    <dd className="text-cream">
                      {plugin.whereItAppears.join(", ") || plugin.placement.views.join(", ")}
                    </dd>
                    <dt>Opens as</dt>
                    <dd className="capitalize text-cream">{plugin.placement.openMode}</dd>
                    <dt>Selection</dt>
                    <dd className="text-cream">
                      {plugin.placement.requiresSelection ? "Required" : "Not required"}
                    </dd>
                  </dl>
                </DetailSection>

                <DetailSection title="Included tools">
                  {plugin.includedTools.length ? (
                    <ul className="grid gap-1.5">
                      {plugin.includedTools.map((tool) => (
                        <li
                          className="flex justify-between gap-2"
                          key={`${tool.name}-${tool.version}`}
                        >
                          <span>{tool.name}</span>
                          <code>{tool.version}</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No executable tools included.</p>
                  )}
                </DetailSection>

                <DetailSection title="Getting started">
                  <ol className="grid list-decimal gap-1.5 pl-4">
                    {plugin.gettingStarted.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ol>
                </DetailSection>

                <DetailSection title="Changelog">
                  <ul className="grid gap-1.5">
                    {plugin.changelog.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </DetailSection>
              </div>

              {plugin.links.length ? (
                <div className="flex flex-wrap gap-2">
                  {plugin.links.map((link) => (
                    <Button asChild key={link.url} size="sm" variant="outline">
                      <a href={link.url} rel="noreferrer" target="_blank">
                        {link.label}
                        <ExternalLink size={13} />
                      </a>
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              {plugin.kind !== "builtin" && plugin.installed && onUninstall ? (
                <Button onClick={() => onUninstall(plugin)} size="sm" variant="destructive">
                  Uninstall
                </Button>
              ) : null}
              {plugin.kind !== "builtin" && plugin.installed && plugin.enabled && onToggle ? (
                <Button onClick={() => onToggle(plugin, false)} size="sm" variant="outline">
                  Disable
                </Button>
              ) : null}
              <MarketplacePrimaryAction
                busy={busy}
                onToggle={onToggle}
                plugin={plugin}
                size="sm"
                {...actions}
              />
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
