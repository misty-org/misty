import { ExternalLink, RefreshCw } from "lucide-react";
import { useCachedResource } from "@/api/cache/cached-resource";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { DesktopSettingsRow, DesktopSettingsSection as Section } from "@/features/settings";
import { Button, EmptyState, ListRowSkeleton, Text } from "@/shared/ui";
import { DirectAppLogo } from "../connected-apps/DirectAppLogo";
import { failureText, marketApi, type EngineConnector } from "./api";

/** Where claude.ai keeps the connectors Claude Code uses when signed in with a Claude account. */
const CLAUDE_CONNECTORS = "https://claude.ai/settings/connectors";

const origins: Record<EngineConnector["origin"], string> = {
  account: "Connected on claude.ai",
  plugin: "From a plugin",
  config: "Added to Claude Code",
};

/** What is wrong with a connector, in words; nothing when it works. */
const problems: Partial<Record<EngineConnector["state"], string>> = {
  needs_sign_in: "Needs sign-in in Claude Code",
  failed: "Couldn’t connect",
  pending: "Waiting for approval in Claude Code",
};

/** An app's key for Misty's brand artwork: "Google Drive" is `google-drive`. */
const appKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, "-");

/**
 * The apps Claude Code already reaches under the person's own sign-in: claude.ai connectors and
 * the servers its plugins bring, one settings row each with the app's logo, where it comes from
 * and, in words, anything wrong with it. Each engine keeps its own: connecting one in Claude
 * doesn't connect it for Codex, whose apps come with its plugins.
 */
export function EngineConnectors() {
  // Kept on this computer (names and states, no sign-in): the last list paints at once and Claude
  // Code is asked again behind it.
  const listing = useCachedResource("engines/claude-connectors", () => marketApi.connectors(), {
    persist: "device",
  });
  const connectors: EngineConnector[] | null = listing.data ?? (listing.loading ? null : []);
  // A failure shows only when there is no list to keep showing.
  const error =
    !listing.data && listing.error
      ? failureText(listing.error, "Claude Code didn't list its apps.")
      : null;
  const load = listing.reload;

  const connected = connectors?.filter((connector) => connector.state !== "off") ?? [];
  return (
    <Section title="Claude Code">
      {connectors === null ? (
        <ListRowSkeleton label="Claude Code apps" rows={4} lines={2} />
      ) : error ? (
        <EmptyState
          inline
          title="Claude Code didn't list its apps"
          line={error}
          action={{
            label: "Try again",
            icon: RefreshCw,
            onClick: () => void load(),
            variant: "secondary",
          }}
        />
      ) : connected.length === 0 ? (
        <EmptyState
          inline
          title="No apps in Claude Code yet"
          line="Connect Gmail, Drive and more on claude.ai, and Claude Code uses them here."
          action={{
            label: "Open claude.ai",
            icon: ExternalLink,
            onClick: () => openExternalLink(CLAUDE_CONNECTORS),
            variant: "secondary",
          }}
        />
      ) : (
        connected.map((connector) => {
          const problem = problems[connector.state];
          return (
            <DesktopSettingsRow
              key={`${connector.origin}:${connector.name}`}
              label={connector.name}
              leading={
                <span className="flex size-8 shrink-0 items-center justify-center">
                  <DirectAppLogo app={appKey(connector.name)} name={connector.name} size={20} />
                </span>
              }
              description={
                <>
                  {origins[connector.origin]}
                  {problem ? (
                    <>
                      {" · "}
                      <Text bare tone="waiting">
                        {problem}
                      </Text>
                    </>
                  ) : null}
                </>
              }
            >
              {null}
            </DesktopSettingsRow>
          );
        })
      )}
      {connected.length ? (
        <div className="flex">
          <Button
            variant="quiet"
            icon={ExternalLink}
            onClick={() => openExternalLink(CLAUDE_CONNECTORS)}
          >
            Manage on claude.ai
          </Button>
        </div>
      ) : null}
    </Section>
  );
}
