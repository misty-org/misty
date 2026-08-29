import type { MailAccount, MailFolder } from "@/api/mail";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  MailProviderIcon,
  Popover,
  PopoverContent,
  PopoverTrigger,
  PrimitiveIconButton,
  Spinner,
  cn,
} from "@/shared/ui";
import {
  Archive,
  ChevronRight,
  FileText,
  Inbox,
  PenLine,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Star,
  Trash2,
} from "lucide-react";
import { useState } from "react";

const folderItems = [
  { kind: "inbox", label: "Inbox", icon: Inbox },
  { kind: "starred", label: "Starred", icon: Star },
  { kind: "sent", label: "Sent", icon: Send },
  { kind: "drafts", label: "Drafts", icon: FileText },
  { kind: "important", label: "Important", icon: Archive },
  { kind: "trash", label: "Trash", icon: Trash2 },
] as const;

export function InboxSidebar(props: {
  accounts: MailAccount[];
  provider: string;
  foldersByConnection: Record<string, MailFolder[]>;
  accountErrorCodes: Record<string, string>;
  selectedConnectionId: string;
  selectedFolderKind: string;
  loading: boolean;
  onSelectAccount: (connectionId: string) => void;
  onSelectFolderKind: (kind: string) => void;
  onCompose: () => void;
  authorizationPending: boolean;
  reconnectingConnectionId: string;
  removingConnectionId: string;
  onConnectAccount: () => void;
  onReconnectAccount: (account: MailAccount) => void;
  onRemoveAccount: (account: MailAccount) => void;
}) {
  const [accountsOpen, setAccountsOpen] = useState(true);
  const providerName = props.provider === "microsoft" ? "Outlook" : "Gmail";
  const allUnread = props.accounts.reduce((sum, account) => sum + account.unread, 0);
  const visibleConnectionIds = new Set(props.accounts.map((account) => account.connection_id));
  const visibleFolders = Object.entries(props.foldersByConnection).flatMap(
    ([connectionId, folders]) => (visibleConnectionIds.has(connectionId) ? folders : []),
  );
  const folderCount = (kind: string) => {
    const matching = visibleFolders.filter((folder) => folder.kind === kind);
    const value = matching.reduce(
      (sum, folder) => sum + (kind === "sent" || kind === "drafts" ? folder.total : folder.unread),
      0,
    );
    return matching.length ? value : undefined;
  };
  const isUnified = !props.selectedConnectionId && !props.selectedFolderKind;

  return (
    <aside
      className="flex min-h-0 flex-col border-r border-charcoal-border bg-charcoal-sidebar"
      data-inbox-left-shelf
    >
      <div className="px-3 pb-2 pt-3">
        <Button
          type="button"
          className="h-9 w-full justify-start gap-3 rounded-lg px-3"
          onClick={props.onCompose}
        >
          <PenLine className="size-4" />
          Compose
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <ScopeButton
          active={isUnified}
          icon={<Inbox className="size-4" />}
          label="All inboxes"
          count={allUnread}
          onClick={() => props.onSelectAccount("")}
        />

        <div className="mt-1 grid gap-0.5">
          {folderItems.map((item) => (
            <ScopeButton
              key={item.kind}
              active={!props.selectedConnectionId && props.selectedFolderKind === item.kind}
              icon={<item.icon className="size-4" />}
              label={item.label}
              count={folderCount(item.kind)}
              onClick={() => props.onSelectFolderKind(item.kind)}
            />
          ))}
        </div>

        <Collapsible
          className="group/accounts mt-5 min-w-0"
          open={accountsOpen}
          onOpenChange={setAccountsOpen}
        >
          <div
            className="mb-1 flex min-w-0 items-center px-2"
            role="group"
            aria-label="Accounts controls"
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex h-9 min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-left",
                  "text-[13px] font-semibold text-cream-bright outline-none",
                  "focus-visible:ring-2 focus-visible:ring-cream-muted focus-visible:ring-offset-1 focus-visible:ring-offset-charcoal-sidebar",
                )}
                aria-label={accountsOpen ? "Collapse Accounts" : "Expand Accounts"}
              >
                <span className="truncate">Accounts</span>
                <ChevronRight
                  className={cn(
                    "size-4 shrink-0 text-cream-muted transition-transform duration-150 motion-reduce:transition-none",
                    accountsOpen && "rotate-90",
                  )}
                  aria-hidden="true"
                />
              </button>
            </CollapsibleTrigger>

            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className={cn(
                "misty-sidebar-icon-target opacity-0 transition-opacity",
                "group-hover/accounts:opacity-100 group-focus-within/accounts:opacity-100",
                "focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
              )}
              aria-label={`Add ${providerName} account`}
              title={`Add ${providerName} account`}
              disabled={props.authorizationPending}
              onClick={props.onConnectAccount}
            >
              {props.authorizationPending ? (
                <Spinner className="size-3.5" />
              ) : (
                <Plus className="size-3.5" />
              )}
            </Button>
          </div>

          <CollapsibleContent className="min-w-0">
            <div className="grid min-w-0 gap-1">
              {props.accounts.map((account) => (
                <AccountButton
                  key={account.connection_id}
                  account={account}
                  runtimeErrorCode={props.accountErrorCodes[account.connection_id]}
                  active={props.selectedConnectionId === account.connection_id}
                  authorizationPending={props.authorizationPending}
                  reconnecting={props.reconnectingConnectionId === account.connection_id}
                  removing={props.removingConnectionId === account.connection_id}
                  onClick={() => props.onSelectAccount(account.connection_id)}
                  onReconnect={() => props.onReconnectAccount(account)}
                  onRemove={() => props.onRemoveAccount(account)}
                />
              ))}
              {!props.accounts.length && props.loading ? (
                <span className="flex items-center gap-2 px-2 py-3 text-xs text-cream-muted">
                  <Spinner className="size-3.5" /> Loading accounts…
                </span>
              ) : null}
              {!props.accounts.length && !props.loading ? (
                <p className="px-2 py-2 text-[11px] text-cream-muted">
                  No {providerName} accounts yet.
                </p>
              ) : null}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </aside>
  );
}

function ScopeButton(props: {
  active: boolean;
  label: string;
  count?: number;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] text-cream-muted transition-colors hover:text-cream",
        props.active && "bg-charcoal-card font-medium text-cream-bright",
      )}
      onClick={props.onClick}
    >
      <span className="grid size-4 shrink-0 place-items-center">{props.icon}</span>
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      {props.count ? (
        <span
          className={cn(
            "min-w-6 rounded-full px-1.5 py-0.5 text-center text-[10px] tabular-nums",
            props.active ? "bg-charcoal-active text-cream-bright" : "text-cream-faint",
          )}
        >
          {props.count}
        </span>
      ) : null}
    </button>
  );
}

function AccountButton(props: {
  account: MailAccount;
  runtimeErrorCode?: string;
  active: boolean;
  authorizationPending: boolean;
  reconnecting: boolean;
  removing: boolean;
  onClick: () => void;
  onReconnect: () => void;
  onRemove: () => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const providerName = props.account.provider === "google" ? "Gmail" : "Outlook";
  const accountLabel = props.account.email || props.account.display_name;
  const needsReconnect = accountNeedsReconnect(props.account, props.runtimeErrorCode);
  return (
    <div className="min-w-0">
      <div className="group/account relative min-w-0">
        <button
          type="button"
          aria-label={`${providerName} account ${accountLabel}`}
          className={cn(
            "misty-sidebar-row-target flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2 pr-12 text-left",
            "text-cream-muted outline-none transition-colors hover:text-cream",
            "focus-visible:ring-2 focus-visible:ring-cream-muted focus-visible:ring-inset",
            props.active && "bg-charcoal-card",
          )}
          onClick={props.onClick}
        >
          <ProviderIcon provider={props.account.provider} />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-cream">
            {accountLabel}
          </span>
          {props.account.unread ? (
            <span className="rounded-full bg-charcoal-active px-1.5 py-0.5 text-[10px] tabular-nums text-cream-bright">
              {props.account.unread}
            </span>
          ) : null}
        </button>

        <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn(
                "misty-sidebar-icon-target absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity",
                "group-hover/account:opacity-100 group-focus-within/account:opacity-100",
                "focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100",
                needsReconnect && "opacity-100 text-notification-red hover:text-notification-red",
              )}
              aria-label={`Configure ${providerName} account ${accountLabel}`}
              title={needsReconnect ? "Reconnect account" : "Configure account"}
            >
              {needsReconnect ? <RefreshCw className="size-4" /> : <Settings2 className="size-4" />}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-auto p-1.5"
            collisionPadding={12}
            side="right"
            sideOffset={8}
          >
            <div className="flex items-center gap-1">
              <PrimitiveIconButton
                label="Reconnect account"
                tooltip="Reconnect"
                size="sm"
                variant="ghost"
                className="size-7"
                disabled={!needsReconnect || props.authorizationPending || props.reconnecting}
                onClick={() => {
                  setSettingsOpen(false);
                  props.onReconnect();
                }}
              >
                {props.reconnecting ? (
                  <Spinner className="size-4" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </PrimitiveIconButton>
              <PrimitiveIconButton
                label="Remove account"
                tooltip="Remove"
                size="sm"
                variant="ghost"
                className="size-7 text-notification-red hover:text-notification-red"
                disabled={props.removing}
                onClick={() => {
                  setSettingsOpen(false);
                  setRemoveOpen(true);
                }}
              >
                {props.removing ? <Spinner className="size-4" /> : <Trash2 className="size-4" />}
              </PrimitiveIconButton>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this {providerName} account?</AlertDialogTitle>
            <AlertDialogDescription>
              Misty will stop syncing mail from {accountLabel}. You can connect it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={props.removing} onClick={props.onRemove}>
              {props.removing ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const reconnectErrorCodes = new Set([
  "credential_invalid",
  "mail_capability_required",
  "mail_provider_authorization_failed",
  "reauthorization_required",
  "refresh_failed",
]);

function accountNeedsReconnect(account: MailAccount, runtimeErrorCode?: string): boolean {
  return (
    reconnectErrorCodes.has(runtimeErrorCode ?? "") ||
    (account.status === "needs_attention" && reconnectErrorCodes.has(account.error_code ?? ""))
  );
}

function ProviderIcon({ provider }: { provider: string }) {
  return <MailProviderIcon provider={provider} className="size-5" />;
}
