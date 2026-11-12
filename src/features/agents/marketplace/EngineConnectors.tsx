import { ExternalLink, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  EmptyState,
  ListRow,
  ListRowSkeleton,
  MenuItem,
  SectionHeading,
  type RowState,
} from "@/shared/ui";
import { failureText, marketApi, type EngineConnector } from "./api";

/** Where claude.ai keeps the connectors Claude Code uses when signed in with a Claude account. */
const CLAUDE_CONNECTORS = "https://claude.ai/settings/connectors";

const origins: Record<EngineConnector["origin"], string> = {
  account: "Connected on claude.ai",
  plugin: "From a plugin",
  config: "Added to Claude Code",
};

function rowState(connector: EngineConnector): RowState {
  switch (connector.state) {
    case "needs_sign_in":
      return { kind: "waiting", label: "Needs sign-in in Claude Code" };
    case "failed":
      return { kind: "failed", label: "Couldn't connect" };
    case "pending":
      return { kind: "waiting", label: "Waiting for approval in Claude Code" };
    default:
      return { kind: "none" };
  }
}

/**
 * The apps Claude Code already reaches under the person's own sign-in: claude.ai connectors and
 * the servers its plugins bring. Each engine keeps its own: connecting one in Claude doesn't
 * connect it for Codex, whose apps come with its plugins.
 */
export function EngineConnectors() {
  const [connectors, setConnectors] = useState<EngineConnector[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setConnectors(null);
    setError(null);
    try {
      setConnectors(await marketApi.connectors());
    } catch (reason) {
      setConnectors([]);
      setError(failureText(reason, "Claude Code didn't list its apps."));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const connected = connectors?.filter((connector) => connector.state !== "off") ?? [];
  return (
    <section aria-labelledby="engine-apps-heading" className="grid gap-1">
      <SectionHeading
        id="engine-apps-heading"
        title="Claude Code apps"
        action={{
          label: "Manage on claude.ai",
          icon: ExternalLink,
          onSelect: () => openExternalLink(CLAUDE_CONNECTORS),
        }}
      />
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
        <ul className="grid">
          {connected.map((connector) => (
            <li key={`${connector.origin}:${connector.name}`} className="list-none">
              <ListRow
                label={connector.name}
                description={origins[connector.origin]}
                state={rowState(connector)}
                menu={
                  connector.origin === "account" ? (
                    <MenuItem
                      icon={ExternalLink}
                      label="Manage on claude.ai"
                      onSelect={() => openExternalLink(CLAUDE_CONNECTORS)}
                    />
                  ) : undefined
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
