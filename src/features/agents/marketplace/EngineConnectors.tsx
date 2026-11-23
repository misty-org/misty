import { ExternalLink, RefreshCw } from "lucide-react";
import { useCachedResource } from "@/api/cache/cached_resource";
import { openExternalLink } from "@/shared/platform/open_external_link";
import { Button, LogoTile, Shelf, ShelfItem, ShelfSkeleton, Text } from "@misty/ui";
import { DirectAppLogo } from "../connected-apps/DirectAppLogo";
import { failureText, marketApi, type EngineConnector } from "./api";

const CLAUDE_CONNECTORS = "https://claude.ai/settings/connectors";

const origins: Record<EngineConnector["origin"], string> = {
  account: "Connected on claude.ai",
  plugin: "From a plugin",
  config: "Added to Claude Code",
};

const problems: Partial<Record<EngineConnector["state"], string>> = {
  needs_sign_in: "needs sign-in in Claude Code",
  failed: "couldn’t connect",
  pending: "waiting for approval in Claude Code",
};

const appKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, "-");

export function EngineConnectors() {
  const listing = useCachedResource("engines/claude-connectors", () => marketApi.connectors(), {
    persist: "device",
  });
  const connectors: EngineConnector[] | null = listing.data ?? (listing.loading ? null : []);
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
