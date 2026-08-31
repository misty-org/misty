import type { MailAccount, MailAddress, MailThread } from "@/api/mail";

export interface InboxThread extends MailThread {
  connectionId: string;
  key: string;
}

export function decodeHtmlEntities(value: string | undefined | null): string {
  if (!value) return "";
  if (!value.includes("&") && !value.includes("&#")) return value;
  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(value, "text/html");
      return doc.body.textContent || value;
    } catch {
      // Fall through to regex replacement
    }
  }
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export function normalizeThread(thread: MailThread, connectionId: string): InboxThread {
  const subject = decodeHtmlEntities(thread.subject).trim();
  return {
    ...thread,
    subject: subject || "(no subject)",
    snippet: decodeHtmlEntities(thread.snippet),
    participants: (thread.participants ?? []).map((p) => ({
      ...p,
      name: p.name ? decodeHtmlEntities(p.name).trim() : undefined,
    })),
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
  const name = address.name ? decodeHtmlEntities(address.name).trim() : "";
  return name || address.email;
}

export type ReplyMode = "reply" | "replyAll" | "forward";

export interface PreparedReplyDraft {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  text: string;
}

export function prepareReplyDraft(
  thread: InboxThread,
  userEmail?: string,
  mode: ReplyMode = "reply",
): PreparedReplyDraft {
  const messages = thread.messages ?? [];
  const latestMessage = messages[messages.length - 1];
  const user = userEmail?.toLowerCase().trim();

  const isSelf = (addr: MailAddress) => Boolean(user && addr.email.toLowerCase().trim() === user);

  if (mode === "forward") {
    const sender = latestMessage ? formatAddress(latestMessage.from) : "Unknown";
    const date = latestMessage ? new Date(latestMessage.sent_at).toLocaleString() : "";
    const recipients = latestMessage?.to.map(formatAddress).join(", ") || "";
    const body = latestMessage?.body.text || latestMessage?.snippet || "";
    const forwardHeader =
      `\n\n---------- Forwarded message ---------\n` +
      `From: ${sender}\nDate: ${date}\nSubject: ${thread.subject}\nTo: ${recipients}\n\n${body}`;

    return {
      to: "",
      cc: "",
      bcc: "",
      subject: thread.subject.toLowerCase().startsWith("fwd:")
        ? thread.subject
        : `Fwd: ${thread.subject}`,
      text: forwardHeader,
    };
  }

  if (mode === "replyAll" && latestMessage) {
    const toRecipients = [latestMessage.from, ...latestMessage.to]
      .filter((addr) => !isSelf(addr))
      .map(formatAddress);
    const ccRecipients = (latestMessage.cc ?? [])
      .filter((addr) => !isSelf(addr))
      .map(formatAddress);

    const uniqueTo = Array.from(new Set(toRecipients)).join(", ");
    const uniqueCc = Array.from(new Set(ccRecipients)).join(", ");

    return {
      to: uniqueTo || (latestMessage.from ? formatAddress(latestMessage.from) : ""),
      cc: uniqueCc,
      bcc: "",
      subject: thread.subject.toLowerCase().startsWith("re:")
        ? thread.subject
        : `Re: ${thread.subject}`,
      text: "",
    };
  }

  // Standard reply
  const replyTo = latestMessage?.from ? formatAddress(latestMessage.from) : "";
  return {
    to: replyTo,
    cc: "",
    bcc: "",
    subject: thread.subject.toLowerCase().startsWith("re:")
      ? thread.subject
      : `Re: ${thread.subject}`,
    text: "",
  };
}
