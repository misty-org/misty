import type { MistyAppSDK, MailAccount, MailThread } from "@misty/sdk";
export interface MailResult {
  account: MailAccount;
  thread: MailThread;
}
export interface MailSearchPage {
  results: MailResult[];
  errors: { account: MailAccount; message: string }[];
  more: { account: MailAccount; token: string }[];
}
export async function searchMail(
  misty: MistyAppSDK,
  accounts: MailAccount[],
  query: string,
  pages?: { account: MailAccount; token: string }[],
): Promise<MailSearchPage> {
  const targets =
    pages ?? accounts.map((account) => ({ account, token: undefined }));
  const settled = await Promise.allSettled(
    targets.map(async ({ account, token }) => {
      if (account.status === "needs_attention")
        throw new Error(
          `Reconnect this mail account${account.error_code ? ` (${account.error_code})` : ""} before searching.`,
        );
      const page = await misty.server.call("mail.threads.list", {
        query: {
          connection_id: account.connection_id,
          query,
          page_token: token,
          page_size: 50,
        },
      });
      return { account, page };
    }),
  );
  const result: MailSearchPage = { results: [], errors: [], more: [] };
  settled.forEach((entry, index) => {
    const account = targets[index].account;
    if (entry.status === "rejected")
      result.errors.push({
        account,
        message:
          entry.reason instanceof Error
            ? entry.reason.message
            : "Search failed. Reconnect this API account and retry.",
      });
    else {
      result.results.push(
        ...entry.value.page.threads.map((thread) => ({ account, thread })),
      );
      if (entry.value.page.next_page_token)
        result.more.push({ account, token: entry.value.page.next_page_token });
    }
  });
  result.results.sort(
    (a, b) =>
      Date.parse(b.thread.last_message_at) -
      Date.parse(a.thread.last_message_at),
  );
  return result;
}
export function mailWebsiteUrl(
  account: MailAccount,
  thread: MailThread,
): string | null {
  if (
    ["google", "gmail"].includes(account.provider) &&
    /^[a-f0-9]+$/i.test(thread.provider_id)
  )
    return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(account.email)}#all/${thread.provider_id}`;
  // Outlook conversation IDs are not web links. Never guess a deep link to a different message.
  return null;
}
