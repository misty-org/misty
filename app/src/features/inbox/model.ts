import type { MailAccount, MailAddress, MailThread } from "@/api/mail";

export interface InboxThread extends MailThread {
  connectionId: string;
  key: string;
}

export function normalizeThread(thread: MailThread, connectionId: string): InboxThread {
  return {
    ...thread,
    subject: thread.subject.trim() || "(no subject)",
    participants: thread.participants ?? [],
    labels: thread.labels ?? [],
    messages: thread.messages ?? [],
    connectionId,
    key: `${connectionId}:${thread.provider_id}`,
  };
}

export function unifiedThreads(threadsByConnection: Record<string, InboxThread[]>): InboxThread[] {
  return [
    ...new Map(
      Object.values(threadsByConnection)
        .flat()
        .map((thread) => [thread.key, thread]),
    ).values(),
  ].sort((left, right) => Date.parse(right.last_message_at) - Date.parse(left.last_message_at));
}

export function mergeThreads(current: InboxThread[], incoming: InboxThread[]): InboxThread[] {
  return [...new Map([...current, ...incoming].map((thread) => [thread.key, thread])).values()];
}

export function accountForThread(
  accounts: MailAccount[],
  thread: Pick<InboxThread, "connectionId">,
): MailAccount | undefined {
  return accounts.find((account) => account.connection_id === thread.connectionId);
}

export function parseAddressList(value: string): MailAddress[] {
  return value
    .split(/[;,]/)
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
}

export function formatAddress(address: MailAddress): string {
  return address.name?.trim() || address.email;
}
