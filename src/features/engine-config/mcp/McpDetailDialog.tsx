// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * One MCP config entry in detail, as a store page: its mark, name and how it connects, the on/off
 * action for writable sources, facts (engine, scope, state, tools), the connection check, the
 * tools it found, then where it lives, the (already redacted) address and the *names* of its
 * variables (never their values). A read-only source says why.
 */
import { FolderOpen } from "lucide-react";
import { useState } from "react";
import {
  AppLogoImage,
  BrandIcon,
  brandIconAsset,
  Button,
  PropertyList,
  StoreDetail,
  StoreDetailSection,
  Text,
  type PropertyListItem,
  type StoreFact,
  LogoTile,
} from "@misty/ui";
import { mcpApi } from "./api";
import { copy, engineLabel, readonlyReasonText, scopeLabels, sourceLabel } from "./copy";
import { ProbeDetail, useProbeTools } from "./ProbeControls";
import type { McpConfigEntry } from "./types";

/**
 * A server's logo at the tile size: the brand's official mark when Misty has its artwork (a
 * server named "github" or "linear"), else its initial, as a third-party app without an icon.
 */
export function ConnectorLogo({ name }: { name: string }) {
  return brandIconAsset(name) ? (
    <LogoTile size="tile">
      <BrandIcon brand={name} size={40} />
    </LogoTile>
  ) : (
    <AppLogoImage name={name} size="tile" />
  );
}

/** How an entry connects, in one line: its transport, then its command or address. */
export function connectorLine(entry: McpConfigEntry): string {
  const target = entry.command
    ? `${entry.command}${entry.argsCount > 0 ? ` +${entry.argsCount}` : ""}`
    : (entry.url ?? copy.transportUnknown);
  return entry.transport ? `${entry.transport} · ${target}` : target;
}

export function McpDetailDialog({
  entry,
  pending,
  workspacePath,
  onToggle,
  onClose,
}: {
  entry: McpConfigEntry;
  pending: boolean;
  /** The folder a check runs against (project sources are found through it). */
  workspacePath: string | null;
  onToggle: (enabled: boolean) => void;
  onClose: () => void;
}) {
  const [revealError, setRevealError] = useState<string | null>(null);
  const tools = useProbeTools(entry);
  const reveal = () => {
    setRevealError(null);
    void mcpApi
      .reveal(entry.path, workspacePath)
      .catch((error: unknown) =>
        setRevealError(error instanceof Error ? error.message : String(error)),
      );
  };

  // Read-only sources have no action: their state shows in the facts, the reason below.
  const action = entry.writable ? (
    entry.enabled ? (
      <Button size="lg" disabled={pending} onClick={() => onToggle(false)}>
        Turn off
      </Button>
    ) : (
      <Button variant="get-filled" size="lg" disabled={pending} onClick={() => onToggle(true)}>
        Turn on
      </Button>
    )
  ) : null;

  const facts: StoreFact[] = [
    { label: copy.detailEngine, value: engineLabel(entry.engine) },
    { label: copy.detailScope, value: scopeLabels[entry.scope] },
    { label: copy.detailState, value: entry.enabled ? "On" : "Off", detail: "In config" },
  ];
  if (tools) facts.push({ label: "Tools", value: String(tools.total) });

  const config: PropertyListItem[] = [{ label: copy.detailSource, value: sourceLabel(entry.source) }];
  if (entry.transport) config.push({ label: copy.detailTransport, value: entry.transport });
  if (entry.command) {
    config.push({
      label: copy.detailCommand,
      value: `${entry.command}${entry.argsCount > 0 ? ` +${entry.argsCount}` : ""}`,
    });
  }
  if (entry.url) config.push({ label: copy.detailUrl, value: entry.url });
  if (entry.envKeys.length > 0) config.push({ label: copy.detailEnv, value: entry.envKeys.join(", ") });
  if (entry.headerKeys.length > 0) {
    config.push({ label: copy.detailHeaders, value: entry.headerKeys.join(", ") });
  }
  config.push({ label: copy.detailPath, value: entry.path });

  return (
    <StoreDetail
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      logo={<ConnectorLogo name={entry.name} />}
      title={entry.name}
      line={connectorLine(entry)}
      action={action}
      facts={facts}
    >
      {!entry.writable ? (
        <Text as="p" tone="muted" wrap className="m-0">
          {readonlyReasonText(entry)}
        </Text>
      ) : null}
      <StoreDetailSection title={copy.probeDetailTitle}>
        <ProbeDetail entry={entry} workspacePath={workspacePath} />
      </StoreDetailSection>
      {tools ? (
        <StoreDetailSection title="Tools">
          {tools.total > tools.tools.length ? (
            <Text as="p" size="meta" tone="muted" wrap className="m-0">
              {`${tools.tools.length} of ${tools.total} shown`}
            </Text>
          ) : null}
          <ul className="m-0 grid list-none gap-1 p-0 sm:grid-cols-2">
            {tools.tools.map((tool) => (
              <li key={tool} className="min-w-0">
                <Text tone="default" full>
                  {tool}
                </Text>
              </li>
            ))}
          </ul>
        </StoreDetailSection>
      ) : null}
      <StoreDetailSection title="Configuration">
        <PropertyList label="Configuration" items={config} />
        <div className="flex">
          <Button size="sm" variant="quiet" icon={FolderOpen} onClick={reveal}>
            {copy.reveal}
          </Button>
        </div>
        {revealError ? (
          <Text as="p" role="alert" tone="danger" wrap className="m-0">
            {revealError}
          </Text>
        ) : null}
        <Text as="p" size="meta" tone="muted" wrap className="m-0">
          {copy.detailRestartHint}
        </Text>
      </StoreDetailSection>
    </StoreDetail>
  );
}
