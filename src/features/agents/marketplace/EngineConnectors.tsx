import { ExternalLink, RefreshCw } from "lucide-react";
import { useCachedResource } from "@/api/cache/cached-resource";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { Button, LogoTile, Shelf, ShelfItem, ShelfSkeleton, Text } from "@misty/ui";
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
  needs_sign_in: "needs sign-in in Claude Code",
  failed: "couldn’t connect",
  pending: "waiting for approval in Claude Code",
};

/** An app's key for Misty's brand artwork: "Google Drive" is `google-drive`. */
const appKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, "-");

/**
 * The apps Claude Code already reaches under the person's own sign-in: claude.ai connectors and
 * the servers its plugins bring, a shelf of them with each app's logo, where it comes from and, in
 * words, anything wrong with it. Each engine keeps its own: connecting one in Claude
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

  const title = "Apps in Claude Code";
  if (connectors === null) return <ShelfSkeleton label={title} items={2} />;
  const connected = connectors.filter((connector) => connector.state !== "off");
  return (
    <Shelf
      title={title}
      action={
        error ? (
          <Button variant="quiet" size="sm" icon={RefreshCw} onClick={() => void load()}>
            Try again
          </Button>
        ) : (
          <Button
            variant="quiet"
            size="sm"
            icon={ExternalLink}
            onClick={() => openExternalLink(CLAUDE_CONNECTORS)}
          >
            {connected.length ? "Manage on claude.ai" : "Open claude.ai"}
          </Button>
        )
      }
    >
      {error || connected.length === 0 ? (
        <li className="pt-2 lg:col-span-2">
          <Text as="p" size="meta" tone="muted" wrap className="m-0">
            {error ?? "Connect Gmail, Drive and more on claude.ai, and Claude Code uses them here."}
          </Text>
        </li>
      ) : (
        connected.map((connector) => {
          const problem = problems[connector.state];
          return (
            <ShelfItem
              key={`${connector.origin}:${connector.name}`}
              logo={
                <LogoTile size="tile">
                  <DirectAppLogo app={appKey(connector.name)} name={connector.name} size={40} />
                </LogoTile>
              }
              title={connector.name}
              line={origins[connector.origin]}
              action={
                problem ? (
                  <Text size="meta" tone="waiting">
                    {problem.charAt(0).toUpperCase() + problem.slice(1)}
                  </Text>
                ) : undefined
              }
            />
          );
        })
      )}
    </Shelf>
  );
}
