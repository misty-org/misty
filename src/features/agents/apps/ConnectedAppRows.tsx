import { CircleAlert, Plug, Plus } from "lucide-react";
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

/** One line for an app's tile: what needs doing, else its account, else how many. */
export function accountSummary(group: AppGroup) {
  const labels = accountLabels(group.accounts);
  if (group.accounts.some((item) => item.status === "needs_attention")) return "Needs attention";
  return group.accounts.length === 1 ? labels[0] : `${labels[0]} +${group.accounts.length - 1}`;
}

/** The popup card for one app: each of its accounts, then Add account. */
export function AppAccountsCard({
  group,
  onDone,
  ...actions
}: { group: AppGroup; onDone(): void } & Actions) {
  const labels = accountLabels(group.accounts);
  return (
    <div className="agent-integrations-accounts" role="group" aria-label={`${group.name} accounts`}>
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
            onDone={onDone}
          />
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="agent-integrations-add"
        disabled={actions.busy}
        onClick={() => {
          onDone();
          actions.onAdd(group);
        }}
      >
        <Plus size={14} aria-hidden="true" />
        Add account
      </Button>
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
  onDone,
}: {
  item: ConnectedApp;
  label: string;
  actions: Actions;
  onDone(): void;
}) {
  return (
    <>
      {item.status === "needs_attention" && (
        <Button
          variant="outline"
          size="sm"
          disabled={actions.busy}
          onClick={() => {
            onDone();
            actions.onReconnect(item);
          }}
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
