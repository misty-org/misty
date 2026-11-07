import type { AiProgressItem } from "@/features/ai-surface/types";

/**
 * A tool refused because the account used its monthly allowance.
 * The server words the result for the agent, starting with its code; the agent relays it and
 * carries on. The person gets a plain line in the chat too, with what to do next. Web search
 * runs on the device's own search key, so only app actions have an allowance.
 */
const limits = [
  {
    match: /\bapp_action_limit_reached\b|\bapp actions for this month\b/i,
    notice:
      "This account has used this month's app actions, so the agent couldn't use your " +
      "connected apps. They renew with your plan's month; whoever runs your Misty server can " +
      "add more.",
  },
];

/** The line for a tool result that hit a monthly limit, or null. */
export function usageLimitNotice(text: string | undefined): string | null {
  if (!text) return null;
  return limits.find((limit) => limit.match.test(text))?.notice ?? null;
}

/** Each limit a reply's tools ran into, once. */
export function usageLimitNotices(items: AiProgressItem[]): string[] {
  const notices = new Set<string>();
  for (const item of items) {
    if (item.type !== "tool") continue;
    const notice = usageLimitNotice(item.error) ?? usageLimitNotice(item.activity?.output);
    if (notice) notices.add(notice);
  }
  return [...notices];
}
