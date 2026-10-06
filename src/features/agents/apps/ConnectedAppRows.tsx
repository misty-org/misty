import { CircleAlert, Plug } from "lucide-react";
import { BrandIcon, brandIconAsset, Button } from "@/shared/ui";
import type { ConnectedApp } from "./api";

/** Official brand artwork when the shared registry has it; a monochrome plug otherwise. */
export function AppLogo({ app, size = 24 }: { app: string; size?: number }) {
  return brandIconAsset(app) ? (
    <BrandIcon brand={app} size={size} />
  ) : (
    <Plug size={Math.round(size * 0.75)} className="text-cream-muted" aria-hidden="true" />
  );
}

export interface AppGroup {
  app: string;
  name: string;
  accounts: ConnectedApp[];
}

/** One group per app, in the server's order. */
export function groupApps(apps: ConnectedApp[]): AppGroup[] {
  const groups = new Map<string, AppGroup>();
  for (const item of apps) {
    const group = groups.get(item.app) ?? { app: item.app, name: item.name, accounts: [] };
    group.accounts.push(item);
    groups.set(item.app, group);
  }
  return [...groups.values()];
}

/** Names each account by its alias, then who it signed in as, then when it was connected. */
export function accountLabels(accounts: ConnectedApp[]) {
  const label = (item: ConnectedApp, withTime: boolean) =>
    item.alias ||
    item.account ||
    `Connected ${new Date(item.created_at).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
    })}`;
  const short = accounts.map((item) => label(item, false));
  return accounts.map((item, index) =>
    short.indexOf(short[index]) === short.lastIndexOf(short[index])
      ? short[index]
      : label(item, true),
  );
}

interface Actions {
  busy: boolean;
  onAdd(group: AppGroup): void;
  onReconnect(item: ConnectedApp): void;
  onDisconnect(item: ConnectedApp, label: string): void;
}

/** The app heads the group and each of its accounts sits beneath it, even when there is one. */
export function ConnectedAppGroup({ group, ...actions }: { group: AppGroup } & Actions) {
  const labels = accountLabels(group.accounts);
  const count = group.accounts.length;
  return (
    <div className="agent-integrations-group">
      <div className="agent-integrations-row">
        <AppLogo app={group.app} size={26} />
        <div className="agent-integrations-row-text">
          <strong>{group.name}</strong>
          <span>{count === 1 ? "1 account" : `${count} accounts`}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={actions.busy}
          onClick={() => actions.onAdd(group)}
        >
          Add account
        </Button>
      </div>
      {group.accounts.map((item, index) => (
        <div key={item.id} className="agent-integrations-row agent-integrations-account">
          <div className="agent-integrations-row-text">
            <strong>{labels[index]}</strong>
            <AccountStatus item={item} />
          </div>
          <AccountActions
            item={item}
            label={`${group.name} (${labels[index]})`}
            actions={actions}
          />
        </div>
      ))}
    </div>
  );
}

function AccountStatus({ item }: { item: ConnectedApp }) {
  if (item.status === "needs_attention")
    return (
      <span className="agent-integrations-attention">
        <CircleAlert size={13} aria-hidden="true" />
        Needs attention
      </span>
    );
  return <span>{item.status === "pending" ? "Waiting for sign-in" : "Connected"}</span>;
}

function AccountActions({
  item,
  label,
  actions,
}: {
  item: ConnectedApp;
  label: string;
  actions: Actions;
}) {
  return (
    <>
      {item.status === "needs_attention" && (
        <Button
          variant="outline"
          size="sm"
          disabled={actions.busy}
          onClick={() => actions.onReconnect(item)}
        >
          Reconnect
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={actions.busy}
        aria-label={`Disconnect ${label}`}
        onClick={() => actions.onDisconnect(item, label)}
      >
        Disconnect
      </Button>
    </>
  );
}
