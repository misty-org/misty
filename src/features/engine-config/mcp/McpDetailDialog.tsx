// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * One MCP config entry in detail: where it lives, how it connects, the (already redacted)
 * address and the *names* of its variables (never their values), and the on/off switch for
 * writable sources. A read-only source says why.
 */
import { FolderOpen } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  OverflowFadeText,
  Surface,
  Switch,
  Text,
} from "@/shared/ui";
import { mcpApi } from "./api";
import { copy, engineLabel, readonlyReasonText, scopeLabels, sourceLabel } from "./copy";
import { ProbeDetail } from "./ProbeControls";
import type { McpConfigEntry } from "./types";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <Text bare tone="muted" className="shrink-0 text-sm">
        {label}
      </Text>
      <Text bare tone="default" className="min-w-0 text-right text-sm">
        {children}
      </Text>
    </div>
  );
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
  const reveal = () => {
    setRevealError(null);
    void mcpApi
      .reveal(entry.path, workspacePath)
      .catch((error: unknown) =>
        setRevealError(error instanceof Error ? error.message : String(error)),
      );
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[80vh] w-130 max-w-[94vw] flex-col gap-3 p-5"
      >
        {/* The title row stays put and the rest scrolls, so a long tool list keeps the dialog
            inside the window. */}
        <div className="flex shrink-0 items-center gap-3 pr-10">
          <DialogTitle className="min-w-0 flex-1 text-base">
            <OverflowFadeText full>{entry.name}</OverflowFadeText>
          </DialogTitle>
          {/* Read-only sources keep the switch, showing the real state, dimmed; the reason is below. */}
          <Switch
            aria-label={copy.toggle(entry.name)}
            checked={entry.enabled}
            disabled={pending || !entry.writable}
            onCheckedChange={onToggle}
          />
        </div>
        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto pr-1">
          <Surface tone="none" edge="hairline" radius="lg" className="px-3 py-1">
            <Row label={copy.detailEngine}>{engineLabel(entry.engine)}</Row>
            <Row label={copy.detailSource}>{sourceLabel(entry.source)}</Row>
            <Row label={copy.detailScope}>{scopeLabels[entry.scope]}</Row>
            <Row label={copy.detailState}>{entry.enabled ? copy.enabled : copy.disabled}</Row>
            {entry.transport ? <Row label={copy.detailTransport}>{entry.transport}</Row> : null}
            {entry.command ? (
              <Row label={copy.detailCommand}>
                <span className="break-all text-xs">
                  {entry.command}
                  {entry.argsCount > 0 ? ` +${entry.argsCount}` : ""}
                </span>
              </Row>
            ) : null}
            {entry.url ? (
              <Row label={copy.detailUrl}>
                <span className="break-all text-xs">{entry.url}</span>
              </Row>
            ) : null}
            {entry.envKeys.length > 0 ? (
              <Row label={copy.detailEnv}>
                <span className="text-xs">{entry.envKeys.join(", ")}</span>
              </Row>
            ) : null}
            {entry.headerKeys.length > 0 ? (
              <Row label={copy.detailHeaders}>
                <span className="text-xs">{entry.headerKeys.join(", ")}</span>
              </Row>
            ) : null}
            <Row label={copy.detailPath}>
              <span className="flex items-start justify-end gap-1">
                <span className="break-all text-xs">{entry.path}</span>
                <IconButton label={copy.reveal} onClick={reveal}>
                  <FolderOpen aria-hidden />
                </IconButton>
              </span>
            </Row>
          </Surface>
          {revealError ? (
            <Text bare as="p" role="alert" tone="default" className="text-xs">
              {revealError}
            </Text>
          ) : null}
          {!entry.writable ? (
            <Surface as="p" tone="well" radius="lg" className="px-3 py-2 text-xs leading-5">
              <Text bare tone="default">
                {readonlyReasonText(entry)}
              </Text>
            </Surface>
          ) : null}
          <ProbeDetail entry={entry} workspacePath={workspacePath} />
          <Text bare as="p" tone="muted" className="text-xs leading-5">
            {copy.detailRestartHint}
          </Text>
        </div>
      </DialogContent>
    </Dialog>
  );
}
