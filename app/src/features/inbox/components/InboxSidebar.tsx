import type { MailAccount, MailFolder } from "@/api/mail";
import { Button, Popover, PopoverContent, PopoverTrigger, Spinner, cn } from "@/shared/ui";
import {
  Archive,
  ChevronDown,
  FileText,
  Inbox,
  Mail,
  PenLine,
  Plus,
  Send,
  Star,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { SiGmail } from "react-icons/si";

const primaryFolders = [
  { kind: "inbox", label: "Inbox", icon: Inbox },
  { kind: "starred", label: "Starred", icon: Star },
  { kind: "sent", label: "Sent", icon: Send },
  { kind: "drafts", label: "Drafts", icon: FileText },
] as const;

const moreFolders = [
  { kind: "important", label: "Important", icon: Archive },
  { kind: "trash", label: "Trash", icon: Trash2 },
] as const;

export function InboxSidebar(props: {
  accounts: MailAccount[];
  foldersByConnection: Record<string, MailFolder[]>;
  accountErrors: Record<string, string>;
  selectedConnectionId: string;
  selectedFolderKind: string;
  loading: boolean;
  onSelectAccount: (connectionId: string) => void;
  onSelectFolderKind: (kind: string) => void;
  onCompose: () => void;
  connectionActions: React.ReactNode;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const allUnread = props.accounts.reduce((sum, account) => sum + account.unread, 0);
  const folders = Object.values(props.foldersByConnection).flat();
  const folderCount = (kind: string) => {
    const matching = folders.filter((folder) => folder.kind === kind);
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
      <div className="flex h-14 shrink-0 items-center px-5">
        <h1 className="m-0 truncate text-lg font-semibold tracking-[-0.02em] text-cream-bright">
          Inbox
        </h1>
      </div>

      <div className="px-3 pb-3">
        <Button
          type="button"
          size="lg"
          className="h-11 w-full justify-start gap-3 rounded-xl px-4 shadow-sm"
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
          {primaryFolders.map((item) => (
            <ScopeButton
              key={item.kind}
              active={!props.selectedConnectionId && props.selectedFolderKind === item.kind}
              icon={<item.icon className="size-4" />}
              label={item.label}
              count={folderCount(item.kind)}
              onClick={() => props.onSelectFolderKind(item.kind)}
            />
          ))}
          <ScopeButton
            active={moreOpen && moreFolders.some((item) => item.kind === props.selectedFolderKind)}
            icon={
              <ChevronDown
                className={cn("size-4 transition-transform", moreOpen && "rotate-180")}
              />
            }
            label="More"
            onClick={() => setMoreOpen((open) => !open)}
          />
          {moreOpen ? (
            <div className="ml-5 grid gap-0.5 border-l border-charcoal-border pl-2">
              {moreFolders.map((item) => (
                <ScopeButton
                  key={item.kind}
                  compact
                  active={!props.selectedConnectionId && props.selectedFolderKind === item.kind}
                  icon={<item.icon className="size-3.5" />}
                  label={item.label}
                  count={folderCount(item.kind)}
                  onClick={() => props.onSelectFolderKind(item.kind)}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="mb-2 mt-6 flex items-center justify-between px-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cream-faint">
            Accounts
          </p>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Connect email account"
              >
                <Plus className="size-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-52 p-2">
              <p className="px-2 pb-1.5 pt-1 text-[11px] font-medium text-cream-muted">
                Add an account
              </p>
              <div className="grid gap-1">{props.connectionActions}</div>
            </PopoverContent>
          </Popover>
        </div>

        <div className="grid gap-1">
          {props.accounts.map((account) => (
            <AccountButton
              key={account.connection_id}
              account={account}
              active={props.selectedConnectionId === account.connection_id}
              error={props.accountErrors[account.connection_id]}
              onClick={() => props.onSelectAccount(account.connection_id)}
            />
          ))}
          {!props.accounts.length && props.loading ? (
            <span className="flex items-center gap-2 px-2 py-3 text-xs text-cream-muted">
              <Spinner className="size-3.5" /> Loading accounts…
            </span>
          ) : null}
          {!props.accounts.length && !props.loading ? (
            <div className="rounded-lg border border-dashed border-charcoal-border px-3 py-3">
              <p className="text-xs font-medium text-cream">No accounts connected</p>
              <p className="mt-1 text-[11px] leading-relaxed text-cream-faint">
                Use the + button to add Gmail or Outlook.
              </p>
              <div className="mt-2 grid gap-1">{props.connectionActions}</div>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function ScopeButton(props: {
  active: boolean;
  label: string;
  count?: number;
  compact?: boolean;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "misty-marker-host flex w-full items-center gap-3 rounded-lg px-3 text-left text-cream-muted transition-colors hover:text-cream",
        props.compact ? "h-8 text-xs" : "h-9 text-[13px]",
        props.active && "misty-active-marker-side bg-charcoal-card font-medium text-cream-bright",
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
  active: boolean;
  error?: string;
  onClick: () => void;
}) {
  const providerName = props.account.provider === "google" ? "Gmail" : "Outlook";
  return (
    <div>
      <button
        type="button"
        className={cn(
          "misty-marker-host flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:text-cream",
          props.active && "misty-active-marker-side bg-charcoal-card",
        )}
        onClick={props.onClick}
      >
        <ProviderIcon provider={props.account.provider} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-cream">{providerName}</span>
          <span className="mt-0.5 block truncate text-[10px] text-cream-faint">
            {props.account.email || props.account.display_name}
          </span>
        </span>
        {props.account.unread ? (
          <span className="rounded-full bg-charcoal-active px-1.5 py-0.5 text-[10px] tabular-nums text-cream-bright">
            {props.account.unread}
          </span>
        ) : null}
      </button>
      {props.error ? (
        <p className="mb-1 mt-1 px-3 text-[10px] leading-relaxed text-sage-fg">{props.error}</p>
      ) : null}
    </div>
  );
}

function ProviderIcon({ provider }: { provider: string }) {
  return provider === "google" ? (
    <SiGmail className="size-4 shrink-0 text-[#EA4335]" />
  ) : (
    <Mail className="size-4 shrink-0 text-[#4c9ee8]" />
  );
}
