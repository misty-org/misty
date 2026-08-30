import type { MailAccount } from "@/api/mail";
import { useInboxStore } from "@/features/inbox";
import { MailProviderIcon } from "@/shared/ui";
import { useEffect } from "react";
import { NavigatorToolDisclosure } from "./NavigatorToolDisclosure";

type InboxProvider = "google" | "microsoft";

export function InboxNavigatorDisclosure(props: {
  accountId: string;
  accounts: MailAccount[];
  active: boolean;
  activeRoute: string;
  path: string;
}) {
  const rememberedProvider = useInboxStore((state) => state.selectedProvider);
  const fallbackProvider =
    inboxProvider(rememberedProvider) ?? firstConnectedProvider(props.accounts);
  const activeProvider = props.active
    ? (inboxProviderFromRoute(props.activeRoute) ?? fallbackProvider)
    : null;
  const rootProvider = activeProvider ?? fallbackProvider;

  useEffect(() => {
    if (!props.active || !activeProvider) return;
    const inbox = useInboxStore.getState();
    if (inbox.selectedProvider !== activeProvider) void inbox.selectProvider(activeProvider);
  }, [activeProvider, props.active, rememberedProvider]);

  return (
    <NavigatorToolDisclosure
      accountId={props.accountId}
      appId="inbox"
      label="Inbox"
      path={`${props.path}?provider=${rootProvider}`}
      active={props.active}
      activeDestination={activeProvider}
      destinations={[
        {
          id: "google",
          label: "Gmail",
          icon: GmailNavigatorIcon,
          path: `${props.path}?provider=google`,
          onSelect: () => void useInboxStore.getState().selectProvider("google"),
        },
        {
          id: "microsoft",
          label: "Outlook",
          icon: OutlookNavigatorIcon,
          path: `${props.path}?provider=microsoft`,
          onSelect: () => void useInboxStore.getState().selectProvider("microsoft"),
        },
      ]}
    />
  );
}

function GmailNavigatorIcon(props: { className?: string; "aria-hidden"?: boolean }) {
  return <MailProviderIcon {...props} provider="google" />;
}

function OutlookNavigatorIcon(props: { className?: string; "aria-hidden"?: boolean }) {
  return <MailProviderIcon {...props} provider="microsoft" />;
}

function inboxProviderFromRoute(route: string): InboxProvider | null {
  try {
    return inboxProvider(new URL(route, "https://misty.local").searchParams.get("provider"));
  } catch {
    return null;
  }
}

function inboxProvider(value: string | null | undefined): InboxProvider | null {
  return value === "google" || value === "microsoft" ? value : null;
}

function firstConnectedProvider(accounts: MailAccount[]): InboxProvider {
  return accounts.some((account) => account.provider === "microsoft") &&
    !accounts.some((account) => account.provider === "google")
    ? "microsoft"
    : "google";
}
